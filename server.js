const express = require("express");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

const CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;
const REDIRECT_URI = process.env.TWITCH_REDIRECT_URI;
const CHANNEL = process.env.TWITCH_BROADCASTER_LOGIN || "quinank";

let accessToken = process.env.TWITCH_ACCESS_TOKEN || null;
let refreshToken = process.env.TWITCH_REFRESH_TOKEN || null;

const cooldowns = new Map();
const COOLDOWN = 30 * 1000;

let oauthState = null;

// Página inicial
app.get("/", (req, res) => {
  res.send("API de Clips Twitch online!");
});

// Iniciar autorização Twitch
app.get("/auth/twitch", (req, res) => {
  oauthState = crypto.randomBytes(32).toString("hex");

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: "clips:edit",
    state: oauthState
  });

  res.redirect(
    `https://id.twitch.tv/oauth2/authorize?${params.toString()}`
  );
});

// Callback da Twitch
app.get("/auth/callback", async (req, res) => {
  try {
    const { code, state, error, error_description } = req.query;

    if (error) {
      return res.status(400).send(
        `Erro Twitch: ${error_description || error}`
      );
    }

    if (!code) {
      return res.status(400).send("Código OAuth não recebido.");
    }

    if (state !== oauthState) {
      return res.status(400).send("Estado OAuth inválido.");
    }

    const response = await fetch(
      "https://id.twitch.tv/oauth2/token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          code,
          grant_type: "authorization_code",
          redirect_uri: REDIRECT_URI
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error(data);
      return res.status(400).send(
        `Erro ao obter token: ${data.message || "erro desconhecido"}`
      );
    }

    accessToken = data.access_token;
    refreshToken = data.refresh_token;

    console.log("OAuth Twitch concluído.");

    res.send(`
      <h1>Twitch autorizado!</h1>
      <p>Agora a API pode criar clips.</p>
      <p>Você pode fechar esta página.</p>
    `);

  } catch (error) {
    console.error(error);
    res.status(500).send("Erro na autorização.");
  }
});

// Descobrir usuário da Twitch
async function getUser(username) {
  if (!accessToken) {
    throw new Error("API ainda não foi autorizada na Twitch.");
  }

  const response = await fetch(
    `https://api.twitch.tv/helix/users?login=${encodeURIComponent(username)}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Client-Id": CLIENT_ID
      }
    }
  );

  const data = await response.json();

  if (!response.ok || !data.data?.length) {
    throw new Error(
      `Não foi possível encontrar o canal ${username}.`
    );
  }

  return data.data[0];
}

// Criar clip
app.get("/clip", async (req, res) => {
  try {
    if (!accessToken) {
      return res.status(401).send(
        "API não autorizada. Acesse /auth/twitch primeiro."
      );
    }

    const now = Date.now();
    const lastClip = cooldowns.get("global") || 0;

    if (now - lastClip < COOLDOWN) {
      const remaining = Math.ceil(
        (COOLDOWN - (now - lastClip)) / 1000
      );

      return res.send(
        `Aguarde ${remaining}s para criar outro clip.`
      );
    }

    const broadcaster = await getUser(CHANNEL);

    const url = new URL(
      "https://api.twitch.tv/helix/clips"
    );

    url.searchParams.set(
      "broadcaster_id",
      broadcaster.id
    );

    url.searchParams.set("duration", "60");

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Client-Id": CLIENT_ID
      }
    });

    const data = await response.json();

    if (!response.ok) {
      console.error(data);

      return res.status(response.status).send(
        `Erro Twitch: ${data.message || "erro desconhecido"}`
      );
    }

    const clip = data.data?.[0];

    if (!clip) {
      return res.status(500).send(
        "A Twitch não retornou o clip."
      );
    }

    cooldowns.set("global", now);

    return res.send(
      `🎬 Clip criado! https://clips.twitch.tv/${clip.id}`
    );

  } catch (error) {
    console.error(error);

    return res.status(500).send(
      `Erro ao criar o clip: ${error.message}`
    );
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
