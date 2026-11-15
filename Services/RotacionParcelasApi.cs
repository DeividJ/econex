using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using AgroAlerta.Data;
using Microsoft.Data.SqlClient;

namespace AgroAlerta.Services;

/// <summary>Guardado de geometrías agrícolas en la MISMA tabla de parcelas.
/// Esta versión de desarrollo comparte el UsuarioId=1 con AgroApi; implementar autenticación antes de publicar.</summary>
public static class RotacionParcelasApi
{
    private const int DemoUserId = 1;

    public static void MapRotacionParcelasApi(this WebApplication app)
    {
        var api = app.MapGroup("/api/rotacion");
        api.MapGet("/parcelas", async (SqlConnectionFactory factory) =>
        {
            await using var cn = factory.Create(); await cn.OpenAsync();
            await EnsureColumns(cn);
            const string sql = "SELECT ParcelaId,Nombre,Localidad,Provincia,Latitud,Longitud,SuperficieHectareas,Pais,AltitudMetros,RegionAgro,SubregionAgro,PoligonoGeoJson,PhSuelo,SodioPorcentaje,ConductividadElectrica,ColorContorno FROM dbo.Parcelas WHERE UsuarioId=@uid AND Activa=1 ORDER BY FechaAlta DESC";
            await using var cmd = new SqlCommand(sql, cn);
            cmd.Parameters.AddWithValue("@uid", DemoUserId);
            var rows = new List<object>();
            await using var rd = await cmd.ExecuteReaderAsync();
            while (await rd.ReadAsync())
            {
                var geometry = rd.IsDBNull(11) ? (JsonElement?)null : JsonSerializer.Deserialize<JsonElement>(rd.GetString(11));
                rows.Add(new {
                    id=rd.GetInt32(0), name=rd.GetString(1), locality=rd.IsDBNull(2)?"":rd.GetString(2),
                    province=rd.GetString(3), lat=rd.IsDBNull(4)?0:(double)rd.GetDecimal(4),
                    lon=rd.IsDBNull(5)?0:(double)rd.GetDecimal(5),
                    hectares=rd.IsDBNull(6)?0:rd.GetDecimal(6), country=rd.IsDBNull(7)?"Argentina":rd.GetString(7),
                    altitude=rd.IsDBNull(8)?(decimal?)null:rd.GetDecimal(8),
                    region=rd.IsDBNull(9)?"":rd.GetString(9), subregion=rd.IsDBNull(10)?"":rd.GetString(10),
                    geometry,
                    ph=rd.IsDBNull(12)?(decimal?)null:rd.GetDecimal(12),
                    sodiumPercent=rd.IsDBNull(13)?(decimal?)null:rd.GetDecimal(13),
                    electricalConductivity=rd.IsDBNull(14)?(decimal?)null:rd.GetDecimal(14),
                    lineColor=rd.IsDBNull(15)?"#C78B59":rd.GetString(15)
                });
            }
            return Results.Ok(rows);
        });

        api.MapPost("/parcelas", async (RotacionParcelaInput input, SqlConnectionFactory factory) =>
        {
            if (string.IsNullOrWhiteSpace(input.Name) || input.Name.Trim().Length > 120 ||
                string.IsNullOrWhiteSpace(input.Province) || input.Province.Length > 100 ||
                input.Vertices is null || input.Vertices.Length < 3 || input.Vertices.Length > 300 ||
                input.Vertices.Any(v => v is null || v.Length != 2 || !double.IsFinite(v[0]) || !double.IsFinite(v[1]) || !InArgentinaBounds(v[0], v[1])))
                return Results.BadRequest(new { message="Indicá un nombre, una provincia y un polígono de 3 a 300 vértices dentro del área de Argentina." });

            if (!ValidSoil(input.Ph, input.SodiumPercent, input.ElectricalConductivity) || !ValidColor(input.LineColor))
                return Results.BadRequest(new { message="Verificá los valores: pH 0–14, sodio 0–100 %, conductividad 0–100 dS/m y un color hexadecimal válido." });

            // Los pares de vértices se envían como [latitud,longitud]; GeoJSON se almacena como [longitud,latitud].
            var points = input.Vertices.Select(v => new Point(v[0],v[1])).ToArray();
            if (points.Distinct().Count() < 3 || SelfIntersects(points))
                return Results.BadRequest(new { message="El contorno requiere tres puntos diferentes y no puede cruzarse a sí mismo." });
            var area = AreaHectares(points);
            if (area < 0.001 || area > 100_000_000)
                return Results.BadRequest(new { message="La superficie calculada no es válida. Revisá el contorno de la parcela." });
            // Centro representativo: media de vértices (suficiente para centrar el mapa; no es un centroide geodésico).
            var lat=points.Average(p=>p.Lat); var lon=points.Average(p=>p.Lon);
            var ring=points.Select(p=>new[]{p.Lon,p.Lat}).ToList(); ring.Add(new[]{points[0].Lon,points[0].Lat});
            var geojson=JsonSerializer.Serialize(new { type="Polygon", coordinates=new[]{ring} });
            await using var cn=factory.Create(); await cn.OpenAsync(); await EnsureColumns(cn);
            const string sql = """
            INSERT dbo.Parcelas (UsuarioId,Nombre,Localidad,Provincia,Latitud,Longitud,SuperficieHectareas,
                Pais,AltitudMetros,RegionAgro,SubregionAgro,PoligonoGeoJson,PhSuelo,SodioPorcentaje,ConductividadElectrica,ColorContorno)
            OUTPUT INSERTED.ParcelaId
            VALUES (@uid,@name,@locality,@province,@lat,@lon,@ha,@country,@altitude,@region,@subregion,@geometry,@ph,@sodium,@conductivity,@color)
            """;
            await using var cmd=new SqlCommand(sql,cn);
            cmd.Parameters.AddWithValue("@uid",DemoUserId);
            cmd.Parameters.AddWithValue("@name",input.Name.Trim());
            cmd.Parameters.AddWithValue("@locality",DbText(input.Locality,120));
            cmd.Parameters.AddWithValue("@province",input.Province.Trim());
            cmd.Parameters.AddWithValue("@lat",Math.Round(lat,6)); cmd.Parameters.AddWithValue("@lon",Math.Round(lon,6));
            cmd.Parameters.AddWithValue("@ha",Math.Round(area,2));
            cmd.Parameters.AddWithValue("@country","Argentina");
            cmd.Parameters.AddWithValue("@altitude",input.Altitude is >= -500 and <= 7000 ? (object)Math.Round(input.Altitude.Value,2) : DBNull.Value);
            cmd.Parameters.AddWithValue("@region",DbText(input.Region,100));
            cmd.Parameters.AddWithValue("@subregion",DbText(input.Subregion,120));
            cmd.Parameters.AddWithValue("@geometry",geojson);
            AddSoilParameters(cmd,input.Ph,input.SodiumPercent,input.ElectricalConductivity,input.LineColor);
            var id=(int)(await cmd.ExecuteScalarAsync() ?? 0);
            return Results.Ok(new { id, hectares=Math.Round(area,2), message="Parcela y contorno guardados en SQL Server." });
        });
        api.MapPut("/parcelas/{id:int}", async (int id, RotacionParcelaUpdate input, SqlConnectionFactory factory) =>
        {
            if (id <= 0 || string.IsNullOrWhiteSpace(input.Name) || input.Name.Trim().Length > 120 ||
                !ValidSoil(input.Ph,input.SodiumPercent,input.ElectricalConductivity) || !ValidColor(input.LineColor))
                return Results.BadRequest(new { message="Comprobá el nombre, los datos de suelo y el color." });
            await using var cn = factory.Create();await cn.OpenAsync();await EnsureColumns(cn);
            const string sql="""
                UPDATE dbo.Parcelas SET Nombre=@name,PhSuelo=@ph,SodioPorcentaje=@sodium,
                    ConductividadElectrica=@conductivity,ColorContorno=@color
                WHERE ParcelaId=@id AND UsuarioId=@uid AND Activa=1
                """;
            await using var cmd=new SqlCommand(sql,cn);
            cmd.Parameters.AddWithValue("@id",id);
            cmd.Parameters.AddWithValue("@uid",DemoUserId);
            cmd.Parameters.AddWithValue("@name",input.Name.Trim());
            AddSoilParameters(cmd,input.Ph,input.SodiumPercent,input.ElectricalConductivity,input.LineColor);
            var affected=await cmd.ExecuteNonQueryAsync();
            return affected==0?Results.NotFound(new {message="No se encontró la parcela."}):Results.Ok(new {id,message="Parcela, color y análisis de suelo actualizados."});
        });
    }

    private static bool ValidSoil(double? ph,double? sodium,double? conductivity) =>
        (!ph.HasValue || (double.IsFinite(ph.Value) && ph.Value>=0 && ph.Value<=14)) &&
        (!sodium.HasValue || (double.IsFinite(sodium.Value) && sodium.Value>=0 && sodium.Value<=100)) &&
        (!conductivity.HasValue || (double.IsFinite(conductivity.Value) && conductivity.Value>=0 && conductivity.Value<=100));
    private static bool ValidColor(string? color) =>
        string.IsNullOrWhiteSpace(color) || Regex.IsMatch(color,@"^#[0-9a-fA-F]{6}$");
    private static void AddSoilParameters(SqlCommand cmd,double? ph,double? sodium,double? conductivity,string? color)
    {
        cmd.Parameters.AddWithValue("@ph",ph.HasValue?(object)Math.Round(ph.Value,2):DBNull.Value);
        cmd.Parameters.AddWithValue("@sodium",sodium.HasValue?(object)Math.Round(sodium.Value,2):DBNull.Value);
        cmd.Parameters.AddWithValue("@conductivity",conductivity.HasValue?(object)Math.Round(conductivity.Value,2):DBNull.Value);
        cmd.Parameters.AddWithValue("@color",string.IsNullOrWhiteSpace(color)?"#C78B59":color.ToUpperInvariant());
    }

    private static object DbText(string? input,int max) => string.IsNullOrWhiteSpace(input)?(object)DBNull.Value:input.Trim()[..Math.Min(input.Trim().Length,max)];
    private static bool InArgentinaBounds(double lat,double lon) => lat >= -55.5 && lat <= -21.5 && lon >= -73.8 && lon <= -53.5;

    // Esférico: fórmula aproximada válida para lotes, áreas grandes requieren GIS de precisión.
    private static double AreaHectares(Point[] vertices)
    {
        const double r=6378137;
        double sum=0;
        for(int i=0;i<vertices.Length;i++)
        {
            var a=vertices[i]; var b=vertices[(i+1)%vertices.Length];
            sum+=(b.Lon-a.Lon)*Math.PI/180 * (2+Math.Sin(a.Lat*Math.PI/180)+Math.Sin(b.Lat*Math.PI/180));
        }
        return Math.Abs(sum)*r*r/2/10000;
    }
    private static bool SelfIntersects(Point[] p)
    {
        for (var i=0;i<p.Length;i++) for (var j=i+1;j<p.Length;j++)
        {
            if(j==i+1 || (i==0&&j==p.Length-1))continue;
            if(Intersects(p[i],p[(i+1)%p.Length],p[j],p[(j+1)%p.Length]))return true;
        }
        return false;
    }
    private static bool Intersects(Point a,Point b,Point c,Point d)
    {
        double Cross(Point p,Point q,Point r)=>(q.Lon-p.Lon)*(r.Lat-p.Lat)-(q.Lat-p.Lat)*(r.Lon-p.Lon);
        var c1=Cross(a,b,c); var c2=Cross(a,b,d); var c3=Cross(c,d,a); var c4=Cross(c,d,b);
        return c1*c2<0 && c3*c4<0;
    }
    private static async Task EnsureColumns(SqlConnection cn)
    {
        // Extensión idempotente: no elimina ni recrea la tabla de parcelas que ya utiliza AgroAlerta.
        const string sql="""
        IF COL_LENGTH('dbo.Parcelas','Pais') IS NULL ALTER TABLE dbo.Parcelas ADD Pais NVARCHAR(60) NULL;
        IF COL_LENGTH('dbo.Parcelas','AltitudMetros') IS NULL ALTER TABLE dbo.Parcelas ADD AltitudMetros DECIMAL(10,2) NULL;
        IF COL_LENGTH('dbo.Parcelas','RegionAgro') IS NULL ALTER TABLE dbo.Parcelas ADD RegionAgro NVARCHAR(100) NULL;
        IF COL_LENGTH('dbo.Parcelas','SubregionAgro') IS NULL ALTER TABLE dbo.Parcelas ADD SubregionAgro NVARCHAR(120) NULL;
        IF COL_LENGTH('dbo.Parcelas','PoligonoGeoJson') IS NULL ALTER TABLE dbo.Parcelas ADD PoligonoGeoJson NVARCHAR(MAX) NULL;
        IF COL_LENGTH('dbo.Parcelas','PhSuelo') IS NULL ALTER TABLE dbo.Parcelas ADD PhSuelo DECIMAL(5,2) NULL;
        IF COL_LENGTH('dbo.Parcelas','SodioPorcentaje') IS NULL ALTER TABLE dbo.Parcelas ADD SodioPorcentaje DECIMAL(5,2) NULL;
        IF COL_LENGTH('dbo.Parcelas','ConductividadElectrica') IS NULL ALTER TABLE dbo.Parcelas ADD ConductividadElectrica DECIMAL(6,2) NULL;
        IF COL_LENGTH('dbo.Parcelas','ColorContorno') IS NULL ALTER TABLE dbo.Parcelas ADD ColorContorno NVARCHAR(7) NULL;
        """;
        await using var cmd=new SqlCommand(sql,cn);
        await cmd.ExecuteNonQueryAsync();
    }
    private record Point(double Lat,double Lon);
    public record RotacionParcelaInput(string Name,string? Locality,string? Province,string? Region,string? Subregion,double? Altitude,double[][] Vertices,
        double? Ph=null,double? SodiumPercent=null,double? ElectricalConductivity=null,string? LineColor=null);
    public record RotacionParcelaUpdate(string Name,double? Ph,double? SodiumPercent,double? ElectricalConductivity,string? LineColor);
}
