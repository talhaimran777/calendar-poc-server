import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json());

app.get("/", (_req, res) => {
  res.send("Hello World!");
});

app.get("/api/auth/login", (req, res) => {
  console.log("HERE");

  const tenantId = process.env.AZURE_AD_TENANT_ID ?? "";
  const clientId = process.env.AZURE_AD_CLIENT_ID ?? "";

  const redirectUri = encodeURIComponent(
    `${process.env.AUTH_URL}/api/auth/callback`,
  );

  const state = Math.random().toString(36).substring(2);

  const scopes = [
    "openid",
    "email",
    "profile",
    "User.Read",
    "User.ReadBasic.All",
    "Calendars.Read",
    "Calendars.ReadWrite",
    "Calendars.Read.Shared",
  ];

  const scopeParam = encodeURIComponent(scopes.join(" "));

  const authURL = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?client_id=${clientId}&response_type=code&redirect_uri=${redirectUri}&response_mode=query&scope=${scopeParam}&state=${state}&prompt=consent`;

  console.log("Redirecting the user to the URL", authURL);

  return res.redirect(authURL);
});

app.get("/api/auth/callback", async (req, res) => {
  const code = req.query.code;

  if (!code) {
    return res.json({ error: "Authentication code missing" });
  }

  const tenantId = process.env.AZURE_AD_TENANT_ID;
  const clientId = process.env.AZURE_AD_CLIENT_ID;
  const clientSecret = process.env.AZURE_AD_CLIENT_SECRET;
  const redirectUri = `${process.env.AUTH_URL}/api/auth/callback`;

  const tokenEndpoint = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

  const params = new URLSearchParams();
  params.append("client_id", clientId);
  params.append(
    "scope",
    "User.Read openid email profile Calendars.Read Calendars.ReadWrite User.ReadBasic.All Calendars.Read.Shared",
  );
  params.append("code", code);
  params.append("redirect_uri", redirectUri);
  params.append("grant_type", "authorization_code");
  params.append("client_secret", clientSecret);

  try {
    const tokenResponse = await fetch(tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    });

    const tokenData = await tokenResponse.json();

    if (tokenData.error) {
      throw new Error(tokenData.error_description);
    }

    const userResponse = await fetch("https://graph.microsoft.com/v1.0/me", {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
      },
    });

    const userData = await userResponse.json();

    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + 2);

    res.cookie(
      "session",
      JSON.stringify({
        user: {
          name: userData.displayName,
          email: userData.mail,
        },
        accessToken: tokenData.access_token,
      }),
      {
        expires: expiresAt,
        path: "/",
      },
    );

    res.redirect("/profile");
  } catch (error) {
    console.log("Auth Error", error);
    res.json({ error: "Authentication error" });
  }
});

const PORT = process.env.PORT || 8000;

app.listen(PORT, () => {
  console.log(`Example app listening on port ${PORT}`);
});
