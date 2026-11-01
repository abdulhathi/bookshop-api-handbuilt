# C# · ASP.NET Core

My Bookshop API in C# with .NET 9 Minimal APIs. Dev port **9003**.

## Step 0: create the project (once)

```bash
cd csharp
dotnet new web -n Bookshop.Api -o src/Bookshop.Api -f net9.0
dotnet new sln -n Bookshop
dotnet sln add src/Bookshop.Api
```

Then start it:

```bash
./start.sh                                                              # what check.sh runs
dotnet watch --project src/Bookshop.Api --urls http://127.0.0.1:9003    # while coding: reloads on save
```

`start.sh` runs `src/Bookshop.Api`. If you name things differently, change `start.sh`, not `check.sh`.

## Tips

- Load the seed products from `../seed.json` (the server runs from this folder).
- Keep everything in memory, as the spec says: no database.
- Packages you will want later: Microsoft.AspNetCore.OpenApi (concept 8), Microsoft.AspNetCore.Authentication.JwtBearer
  (10), HotChocolate.AspNetCore (17). Rate limiting, timeouts and problem details are built into ASP.NET Core.
- Check a concept: `cd .. && ./check.sh csharp 1`.
