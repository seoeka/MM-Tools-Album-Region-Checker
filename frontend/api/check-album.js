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
  const match = url.match(/album\/([a-zA-Z0-9]+)(\?|$)/);
  return match ? match[1] : null;
}

async function getSpotifyAccessToken() {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

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

  const data = await response.json();
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

  return response.json();
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
    const { provider, url, regions } = req.body;

    if (provider !== "spotify") {
      return res.status(400).json({
        error: "Only Spotify is supported in public version",
      });
    }

    const albumId = parseSpotifyAlbumId(url);
    const requestedRegions = regions || ["JP", "US", "ID"];

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
    const baseTracks = albumByRegion[requestedRegions[0]].tracks.items;

    const tracks = baseTracks.map((baseTrack, index) => {
      const statuses = {};

      for (const regionCode of requestedRegions) {
        const regionalTrack =
          albumByRegion[regionCode]?.tracks?.items?.[index] || null;
        statuses[regionCode] = mapSpotifyTrackStatus(regionalTrack);
      }

      return {
        id: baseTrack.id,
        title: baseTrack.name,
        duration: formatDuration(baseTrack.duration_ms),
        statuses,
      };
    });

    res.json({
      album: {
        id: albumByRegion[requestedRegions[0]].id,
        title: albumByRegion[requestedRegions[0]].name,
        artist: albumByRegion[requestedRegions[0]].artists
          .map((a) => a.name)
          .join(", "),
        image: albumByRegion[requestedRegions[0]].images[0]?.url,
        provider: "spotify",
      },
      tracks,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}