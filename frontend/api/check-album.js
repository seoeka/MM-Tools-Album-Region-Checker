import { Buffer } from "node:buffer";
import process from "node:process";

const REGION_MAP = {
  JP: "JP",
  US: "US",
  ID: "ID",
};

function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function parseSpotifyAlbumId(url) {
  if (!url || typeof url !== "string") return null;
  const match = url.match(/album\/([a-zA-Z0-9]+)(\?|$)/);
  return match ? match[1] : null;
}

async function getSpotifyAccessToken() {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Missing Spotify environment variables");
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
    }),
  });

  const text = await response.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Spotify token returned non-JSON: ${text.slice(0, 200)}`);
  }

  if (!response.ok) {
    throw new Error(`Spotify token error: ${JSON.stringify(data)}`);
  }

  if (!data.access_token) {
    throw new Error("Spotify token missing access_token");
  }

  return data.access_token;
}

async function fetchSpotifyAlbum(albumId, market, token) {
  const response = await fetch(
    `https://api.spotify.com/v1/albums/${albumId}?market=${market}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  const text = await response.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Spotify album returned non-JSON for ${market}: ${text.slice(0, 200)}`);
  }

  if (!response.ok) {
    throw new Error(`Spotify album fetch failed for ${market}: ${JSON.stringify(data)}`);
  }

  return data;
}

function mapSpotifyTrackStatus(track) {
  if (!track) return "removed";

  const reason = track?.restrictions?.reason;

  if (reason === "product") return "premium";
  if (reason === "market" || track?.is_playable === false) return "unavailable";

  return "playable";
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({
        error: "Method not allowed",
      });
    }

    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : req.body || {};

    const { provider, url, regions } = body;

    if (!provider || !url) {
      return res.status(400).json({
        error: "provider and url are required",
      });
    }

    if (provider === "apple") {
      return res.status(400).json({
        error: "Apple Music check is available on localhost only.",
      });
    }

    if (provider !== "spotify") {
      return res.status(400).json({
        error: "Only Spotify is supported in public version.",
      });
    }

    const albumId = parseSpotifyAlbumId(url);

    if (!albumId) {
      return res.status(400).json({
        error: "Invalid Spotify album URL",
      });
    }

    const requestedRegions =
      Array.isArray(regions) && regions.length
        ? regions.filter((code) => REGION_MAP[code])
        : ["JP", "US", "ID"];

    if (!requestedRegions.length) {
      return res.status(400).json({
        error: "No valid regions provided",
      });
    }

    const token = await getSpotifyAccessToken();

    const albumEntries = await Promise.all(
      requestedRegions.map(async (regionCode) => {
        const album = await fetchSpotifyAlbum(
          albumId,
          REGION_MAP[regionCode],
          token
        );
        return [regionCode, album];
      })
    );

    const albumByRegion = Object.fromEntries(albumEntries);
    const baseRegion = requestedRegions[0];
    const baseAlbum = albumByRegion[baseRegion];

    if (!baseAlbum?.tracks?.items || !Array.isArray(baseAlbum.tracks.items)) {
      throw new Error("Spotify album response missing tracks.items");
    }

    const baseTracks = baseAlbum.tracks.items;

    const tracks = baseTracks.map((baseTrack, index) => {
      const statuses = {};

      for (const regionCode of requestedRegions) {
        const regionalTrack =
          albumByRegion[regionCode]?.tracks?.items?.[index] || null;
        statuses[regionCode] = mapSpotifyTrackStatus(regionalTrack);
      }

      return {
        id: baseTrack.id || `track-${index}`,
        title: baseTrack.name || `Track ${index + 1}`,
        duration: formatDuration(baseTrack.duration_ms || 0),
        statuses,
      };
    });

    return res.status(200).json({
      album: {
        id: baseAlbum.id || albumId,
        title: baseAlbum.name || "Unknown Album",
        artist:
          baseAlbum.artists?.map((a) => a.name).join(", ") || "Unknown Artist",
        image: baseAlbum.images?.[0]?.url || null,
        provider: "spotify",
      },
      tracks,
    });
  } catch (err) {
    console.error("VERCEL API ERROR:", err);

    return res.status(500).json({
      error: err?.message || "Internal server error",
    });
  }
}