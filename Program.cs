using AgroAlerta.Services;
var builder = WebApplication.CreateBuilder(args);

builder.Services.AddRazorPages();
builder.Services.AddScoped<AgroAlerta.Data.SqlConnectionFactory>();
builder.Services.AddHttpClient("Groq", client => client.Timeout = TimeSpan.FromSeconds(45));
builder.Services.AddHttpClient();

var app = builder.Build();

if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Error");
    app.UseHsts();
}

app.UseHttpsRedirection();
app.UseStaticFiles();
app.UseRouting();
app.MapRazorPages();
app.MapAgroApi();
app.MapRotacionParcelasApi();
app.MapEstacionesApi();

app.Run();
