const express = require("express");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

const CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;
const CHANNEL = process.env.TWITCH_CHANNEL;
const REDIRECT_URI = process.env.REDIRECT_URI;

let accessToken = process.env.TWITCH_ACCESS_TOKEN;
let refreshToken = process.env.TWITCH_REFRESH_TOKEN;

const cooldowns = new Map();
const COOLDOWN = 30 * 1000; // 30 segundos

async function getToken() {
  if (accessToken) return accessToken;

  const response = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: "authorization_code",
      redirect_uri: REDIRECT_URI,
      code: process.env.TWITCH_AUTH_CODE
    })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(JSON.stringify(data));
  }

  accessToken = data.access_token;
  refreshToken = data.refresh_token;

  return accessToken;
}

async function getUser(username) {
  const token = await getToken();

  const response = await fetch(
    `https://api.twitch.tv/helix/users?login=${encodeURIComponent(username)}`,
    {
      headers: {
        "Authorization": `Bearer ${token}`,
        "Client-Id": CLIENT_ID
      }
    }
  );

  const data = await response.json();

  if (!response.ok || !data.data?.length) {
    throw new Error("Canal não encontrado.");
  }

  return data.data[0];
}

app.get("/", (req, res) => {
  res.send("API de Clips Twitch online!");
});

app.get("/auth", (req, res) => {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: "clips:edit"
  });

  res.redirect(`https://id.twitch.tv/oauth2/authorize?${params}`);
});

app.get("/callback", async (req, res) => {
  try {
    const code = req.query.code;

    if (!code) {
      return res.status(400).send("Código OAuth não recebido.");
    }

    const response = await fetch("https://id.twitch.tv/oauth2/token", {
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
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(400).json(data);
    }

    accessToken = data.access_token;
    refreshToken = data.refresh_token;

    res.send(`
      <h1>Twitch autorizado!</h1>
      <p>Agora a API pode criar clips.</p>
      <p>Access token recebido com sucesso.</p>
    `);

    console.log("ACCESS TOKEN:", accessToken);
    console.log("REFRESH TOKEN:", refreshToken);

  } catch (error) {
    console.error(error);
    res.status(500).send("Erro na autorização.");
  }
});

app.get("/clip", async (req, res) => {
  try {
    const now = Date.now();
    const lastClip = cooldowns.get("global") || 0;

    if (now - lastClip < COOLDOWN) {
      const remaining = Math.ceil(
        (COOLDOWN - (now - lastClip)) / 1000
      );

      return res.send(`Aguarde ${remaining}s para criar outro clip.`);
    }

    cooldowns.set("global", now);

    const broadcaster = await getUser(CHANNEL);
    const token = await getToken();

    const url = new URL("https://api.twitch.tv/helix/clips");

    url.searchParams.set(
      "broadcaster_id",
      broadcaster.id
    );

    url.searchParams.set(
      "duration",
      "60"
    );

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
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
      return res.status(500).send("A Twitch não retornou o clip.");
    }

    return res.send(
      `🎬 Clip criado! https://clips.twitch.tv/${clip.id}`
    );

  } catch (error) {
    console.error(error);
    res.status(500).send("Erro ao criar o clip.");
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
