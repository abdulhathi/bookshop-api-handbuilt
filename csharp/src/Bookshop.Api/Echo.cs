
using System.Text.Json;

public static class Echo
{
  public static void MapEcho(this WebApplication app) => app.MapMethods("/v1/echo", ["GET", "POST"], Handle);

  static async Task<IResult> Handle(HttpRequest request)
  {
    var query = request.Query.ToDictionary(q => q.Key, q => q.Value.FirstOrDefault());
    var headers = request.Headers.ToDictionary(h => h.Key.ToLowerInvariant(), h => h.Value.ToString());
    if (headers.ContainsKey("authorization")) headers["authorization"] = "Bearer ***";
    var bodyText = await new StreamReader(request.Body).ReadToEndAsync();
    JsonElement? body = bodyText.Length == 0 ? null : JsonSerializer.Deserialize<JsonElement>(bodyText);
    return Results.Json(new
    {
      method = request.Method,
      path = request.Path.Value,
      query,
      headers,
      body
    });
  }
}

