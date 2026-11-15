using System.Security.Cryptography;
using System.Text;
using AgroAlerta.Data;
using Microsoft.Data.SqlClient;

namespace AgroAlerta.Services;

/// <summary>
/// Integración genérica por HTTP(S) entrante. No presupone compatibilidad con
/// protocolos propietarios ni acceso remoto a la IP privada de una estación.
/// La aplicación original funciona en modo demostración con UsuarioId=1.
/// Antes de publicarla, proteger la administración con autenticación real.
/// </summary>
public static class EstacionesApi
{
    private const int DemoUserId = 1;
    private static readonly TimeSpan Freshness = TimeSpan.FromMinutes(90);

    public static void MapEstacionesApi(this WebApplication app)
    {
        var api = app.MapGroup("/api/estaciones");

        api.MapGet("", async (SqlConnectionFactory factory) =>
        {
            try
            {
                await using var cn = factory.Create();
                await cn.OpenAsync();
                await using var cmd = new SqlCommand(StationSelect + " WHERE e.UsuarioId=@uid ORDER BY e.FechaAltaUtc DESC", cn);
                cmd.Parameters.AddWithValue("@uid", DemoUserId);
                var result = new List<StationStatus>();
                await using var rd = await cmd.ExecuteReaderAsync();
                while (await rd.ReadAsync()) result.Add(ReadStation(rd));
                return Results.Ok(result);
            }
            catch (SqlException ex) { return SqlFailure(ex); }
        });

        api.MapPost("", async (CreateStationInput input, SqlConnectionFactory factory) =>
        {
            var name = input.Name?.Trim();
            var brand = input.Brand?.Trim();
            var model = input.Model?.Trim();
            var mode = input.Mode?.Trim().ToLowerInvariant();
            if (string.IsNullOrWhiteSpace(name) || name.Length > 120 ||
                string.IsNullOrWhiteSpace(brand) || brand.Length > 100 ||
                string.IsNullOrWhiteSpace(model) || model.Length > 100 ||
                mode is not ("directa" or "pasarela"))
                return Results.BadRequest(new { message = "Completá nombre, marca, modelo y método de conexión válidos." });
            if (input.ParcelId is <= 0)
                return Results.BadRequest(new { message = "La parcela seleccionada no es válida." });

            var key = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
            var hash = HashKey(key);
            try
            {
                await using var cn = factory.Create();
                await cn.OpenAsync();
                if (input.ParcelId.HasValue)
                {
                    await using var parcel = new SqlCommand("SELECT COUNT(1) FROM dbo.Parcelas WHERE ParcelaId=@id AND UsuarioId=@uid AND Activa=1", cn);
                    parcel.Parameters.AddWithValue("@id", input.ParcelId.Value);
                    parcel.Parameters.AddWithValue("@uid", DemoUserId);
                    if ((int)(await parcel.ExecuteScalarAsync() ?? 0) == 0)
                        return Results.BadRequest(new { message = "La parcela indicada no existe o no está disponible." });
                }
                const string sql = """
                    INSERT INTO dbo.EstacionesMeteorologicas (UsuarioId, ParcelaId, Nombre, Marca, Modelo, ModoConexion, ClaveHash)
                    OUTPUT INSERTED.EstacionId
                    VALUES (@uid, @parcel, @name, @brand, @model, @mode, @hash)
                    """;
                await using var cmd = new SqlCommand(sql, cn);
                cmd.Parameters.AddWithValue("@uid", DemoUserId);
                cmd.Parameters.AddWithValue("@parcel", (object?)input.ParcelId ?? DBNull.Value);
                cmd.Parameters.AddWithValue("@name", name);
                cmd.Parameters.AddWithValue("@brand", brand);
                cmd.Parameters.AddWithValue("@model", model);
                cmd.Parameters.AddWithValue("@mode", mode);
                cmd.Parameters.AddWithValue("@hash", hash);
                var id = (int)(await cmd.ExecuteScalarAsync() ?? 0);
                return Results.Created($"/api/estaciones/{id}/estado", new
                {
                    id, key, message = "Estación registrada. Todavía no está conectada: configurá el envío y comprobá una lectura real.",
                    endpointPath = $"/api/estaciones/{id}/lecturas"
                });
            }
            catch (SqlException ex) { return SqlFailure(ex); }
        });

        api.MapGet("/{id:int}/estado", async (int id, SqlConnectionFactory factory) =>
        {
            try
            {
                await using var cn = factory.Create();
                await cn.OpenAsync();
                await using var cmd = new SqlCommand(StationSelect + " WHERE e.UsuarioId=@uid AND e.EstacionId=@id", cn);
                cmd.Parameters.AddWithValue("@uid", DemoUserId);
                cmd.Parameters.AddWithValue("@id", id);
                await using var rd = await cmd.ExecuteReaderAsync();
                return await rd.ReadAsync() ? Results.Ok(ReadStation(rd)) : Results.NotFound(new { message = "No se encontró la estación." });
            }
            catch (SqlException ex) { return SqlFailure(ex); }
        });

        // El dispositivo o la pasarela envía una lectura usando X-Station-Key.
        // Se acepta JSON genérico documentado; otros protocolos requieren un adaptador.
        api.MapPost("/{id:int}/lecturas", async (int id, WeatherReadingInput input, HttpRequest request, SqlConnectionFactory factory) =>
        {
            var key = request.Headers["X-Station-Key"].ToString();
            if (key.Length != 64 || !key.All(Uri.IsHexDigit))
                return Results.Unauthorized();

            var fields = new[] { input.TemperatureC, input.HumidityPct, input.RainMm, input.WindKmh, input.PressureHpa };
            if (!fields.Any(x => x.HasValue))
                return Results.BadRequest(new { message = "No se recibió ninguna medición. Enviá al menos una variable meteorológica." });
            if (fields.Any(x => x.HasValue && !double.IsFinite(x.Value)) ||
                !InRange(input.TemperatureC, -90, 65) || !InRange(input.HumidityPct, 0, 100) ||
                !InRange(input.RainMm, 0, 1000) || !InRange(input.WindKmh, 0, 500) ||
                !InRange(input.PressureHpa, 800, 1100))
                return Results.BadRequest(new { message = "Una medición está fuera de rango. Revisá unidades: °C, %, mm, km/h y hPa." });

            var timestamp = input.Timestamp?.ToUniversalTime() ?? DateTimeOffset.UtcNow;
            if (timestamp > DateTimeOffset.UtcNow.AddMinutes(10) || timestamp < DateTimeOffset.UtcNow.AddDays(-7))
                return Results.BadRequest(new { message = "La fecha de la medición es inválida (más de 10 minutos en el futuro o más de 7 días de antigüedad)." });

            try
            {
                await using var cn = factory.Create();
                await cn.OpenAsync();
                string? expectedHash;
                await using (var find = new SqlCommand("SELECT ClaveHash FROM dbo.EstacionesMeteorologicas WHERE EstacionId=@id AND Activa=1", cn))
                {
                    find.Parameters.AddWithValue("@id", id);
                    expectedHash = (string?)await find.ExecuteScalarAsync();
                }
                if (expectedHash is null || !FixedTimeHashEquals(expectedHash, HashKey(key)))
                    return Results.Unauthorized();

                const string sql = """
                    INSERT dbo.LecturasMeteorologicas (EstacionId, FechaMedicionUtc, TemperaturaC, HumedadPct, LluviaMm, VientoKmh, PresionHpa, EsPrueba)
                    VALUES (@id, @timestamp, @temp, @humidity, @rain, @wind, @pressure, @test)
                    """;
                await using var cmd = new SqlCommand(sql, cn);
                cmd.Parameters.AddWithValue("@id", id);
                cmd.Parameters.AddWithValue("@timestamp", timestamp.UtcDateTime);
                cmd.Parameters.AddWithValue("@temp", DbValue(input.TemperatureC));
                cmd.Parameters.AddWithValue("@humidity", DbValue(input.HumidityPct));
                cmd.Parameters.AddWithValue("@rain", DbValue(input.RainMm));
                cmd.Parameters.AddWithValue("@wind", DbValue(input.WindKmh));
                cmd.Parameters.AddWithValue("@pressure", DbValue(input.PressureHpa));
                cmd.Parameters.AddWithValue("@test", input.IsTest);
                await cmd.ExecuteNonQueryAsync();
                return Results.Ok(new { message = input.IsTest ? "Lectura de prueba recibida. No confirma conexión con la estación física." : "Lectura recibida correctamente.", isTest = input.IsTest });
            }
            catch (SqlException ex) { return SqlFailure(ex); }
        });
    }

    private static bool InRange(double? value, double min, double max) => !value.HasValue || (value.Value >= min && value.Value <= max);
    private static object DbValue(double? value) => value.HasValue ? value.Value : DBNull.Value;
    private static string HashKey(string key) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(key)));
    private static bool FixedTimeHashEquals(string a, string b)
    {
        try { return CryptographicOperations.FixedTimeEquals(Convert.FromHexString(a), Convert.FromHexString(b)); }
        catch (FormatException) { return false; }
    }

    private const string StationSelect = """
        SELECT e.EstacionId, e.Nombre, e.Marca, e.Modelo, e.ModoConexion, e.ParcelaId,
               p.Nombre AS Parcela, e.FechaAltaUtc,
               l.FechaRecepcionUtc, l.FechaMedicionUtc, l.TemperaturaC, l.HumedadPct,
               l.LluviaMm, l.VientoKmh, l.PresionHpa
        FROM dbo.EstacionesMeteorologicas e
        LEFT JOIN dbo.Parcelas p ON p.ParcelaId=e.ParcelaId
        OUTER APPLY (
            SELECT TOP 1 FechaRecepcionUtc, FechaMedicionUtc, TemperaturaC, HumedadPct, LluviaMm, VientoKmh, PresionHpa
            FROM dbo.LecturasMeteorologicas
            WHERE EstacionId=e.EstacionId AND EsPrueba=0
            ORDER BY FechaRecepcionUtc DESC, LecturaId DESC
        ) l
        """;

    private static StationStatus ReadStation(SqlDataReader rd)
    {
        var received = rd.IsDBNull(8) ? (DateTime?)null : DateTime.SpecifyKind(rd.GetDateTime(8), DateTimeKind.Utc);
        var measured = rd.IsDBNull(9) ? (DateTime?)null : DateTime.SpecifyKind(rd.GetDateTime(9), DateTimeKind.Utc);
        var now = DateTime.UtcNow;
        var connected = received.HasValue && measured.HasValue &&
            now - received.Value <= Freshness && now - measured.Value <= Freshness &&
            measured.Value <= now.AddMinutes(10);
        var reason = !received.HasValue
            ? "Todavía no llegó ninguna lectura real. No es posible conocer la causa exacta sin datos del dispositivo: revisá Wi-Fi, Internet, URL, formato JSON y clave X-Station-Key."
            : !measured.HasValue
                ? "La última lectura no incluye una fecha de medición válida."
                : now - measured.Value > Freshness
                    ? "La última medición es antigua. Revisá la hora de la estación y su envío de datos."
                    : now - received.Value > Freshness
                        ? "No recibimos datos recientes. Revisá Wi-Fi, Internet, alimentación y configuración del envío."
                        : "La fecha del dispositivo es posterior a la hora del servidor. Revisá su reloj.";
        return new StationStatus(
            rd.GetInt32(0), rd.GetString(1), rd.GetString(2), rd.GetString(3), rd.GetString(4),
            rd.IsDBNull(5) ? null : rd.GetInt32(5), rd.IsDBNull(6) ? null : rd.GetString(6),
            connected ? "connected" : "error",
            connected ? "Se ha conectado correctamente." : "Error en la conexión.",
            connected ? "Se recibió una medición válida y reciente." : reason,
            received, measured,
            rd.IsDBNull(10) ? null : rd.GetDouble(10),
            rd.IsDBNull(11) ? null : rd.GetDouble(11),
            rd.IsDBNull(12) ? null : rd.GetDouble(12),
            rd.IsDBNull(13) ? null : rd.GetDouble(13),
            rd.IsDBNull(14) ? null : rd.GetDouble(14));
    }

    private static IResult SqlFailure(SqlException ex) => Results.Problem(
        ex.Number == 208
            ? "Faltan las tablas del módulo. Ejecutá Database/02-EstacionesMeteorologicas.sql en AgroAlertaDb."
            : "No se pudo acceder a SQL Server. Revisá la conexión, el servidor y los permisos de AgroAlertaDb.",
        statusCode: 503, title: "No se pudo consultar la base de datos");

    public sealed record CreateStationInput(string? Name, string? Brand, string? Model, string? Mode, int? ParcelId);
    public sealed record WeatherReadingInput(DateTimeOffset? Timestamp, double? TemperatureC, double? HumidityPct, double? RainMm, double? WindKmh, double? PressureHpa, bool IsTest = false);
    public sealed record StationStatus(int Id, string Name, string Brand, string Model, string Mode, int? ParcelId, string? Parcel,
        string Status, string Message, string Reason, DateTime? LastReceivedUtc, DateTime? LastMeasuredUtc,
        double? TemperatureC, double? HumidityPct, double? RainMm, double? WindKmh, double? PressureHpa);
}
