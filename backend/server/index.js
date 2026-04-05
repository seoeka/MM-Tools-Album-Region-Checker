import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import process from "node:process";
import { Buffer } from "node:buffer";
import { chromium } from "playwright";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8787;

app.use(cors({
  origin: [
    "http://localhost:5173",
    "https://mm-tools-album-region-checker.vercel.app"
  ]
}));app.use(express.json());

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

function parseAppleAlbumUrl(url) {
  if (!url || typeof url !== "string") return null;

  const match = url.match(
    /music\.apple\.com\/([a-z]{2})\/album\/([^/]+)\/(\d+)/i
  );

  if (!match) return null;

  return {
    storefront: match[1].toLowerCase(),
    slug: match[2],
    albumId: match[3],
  };
}

function normalizeTitle(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/\(feat\.[^)]+\)/gi, "")
    .replace(/\(featuring[^)]+\)/gi, "")
    .replace(/\(bonus track\)/gi, "")
    .replace(/\[.*?\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function titlesMatch(a, b) {
  const aa = normalizeTitle(a);
  const bb = normalizeTitle(b);

  if (!aa || !bb) return false;
  return aa === bb;
}

async function getSpotifyAccessToken() {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Missing SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET in .env");
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

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Spotify token error: ${text}`);
  }

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

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Spotify album fetch failed for ${market}: ${text}`);
  }

  return response.json();
}

function mapSpotifyTrackStatus(track) {
  if (!track) return "removed";

  const reason = track?.restrictions?.reason;

  if (reason === "product") return "premium";
  if (reason === "market" || track?.is_playable === false) return "unavailable";

  return "playable";
}

function normalizeTrack(track, index) {
  return {
    id: track?.id || `track-${index}`,
    title: track?.name || `Track ${index + 1}`,
    duration: formatDuration(track?.duration_ms || 0),
  };
}

let browserPromise = null;

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      headless: true,
    });
  }
  return browserPromise;
}

async function scrapeAppleAlbumPage({ storefront, slug, albumId }) {
  const browser = await getBrowser();
  const page = await browser.newPage({
    locale: "en-US",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36",
    viewport: { width: 1440, height: 2000 },
  });

  const url = `https://music.apple.com/${storefront}/album/${slug}/${albumId}`;

  try {
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });

    await page.waitForTimeout(2500);

    const bodyText = await page.locator("body").innerText().catch(() => "");
    const notFound =
      bodyText.includes("The page you're looking for can't be found.") ||
      bodyText.includes("Page Not Found");

    if (notFound) {
      return {
        title: null,
        artist: null,
        image: null,
        tracks: [],
        unavailable: true,
      };
    }

    const title = await page
      .locator('[data-testid="non-editable-product-title"] > span[dir="auto"]')
      .first()
      .textContent()
      .catch(() => null);

    const artist = await page
      .locator('[data-testid="product-subtitles"] a[data-testid="click-action"]')
      .first()
      .textContent()
      .catch(() => null);

    let image = await page.evaluate(() => {
    const pickBest = (srcset) => {
      const raw = String(srcset || "").trim();
      if (!raw) return null;
      const first = raw.split(",")[0]?.trim() || "";
      const url = first.split(/\s+/)[0]?.trim() || "";
      return url || null;
    };

    const mainPicture = document.querySelector(".artwork__main picture");
    if (mainPicture) {
      const webpSource = mainPicture.querySelector('source[type="image/webp"]');
      const jpegSource = mainPicture.querySelector('source[type="image/jpeg"]');

      const fromWebp = pickBest(webpSource?.getAttribute("srcset"));
      if (fromWebp) return fromWebp;

      const fromJpeg = pickBest(jpegSource?.getAttribute("srcset"));
      if (fromJpeg) return fromJpeg;
    }

    const ogImage = document
      .querySelector('meta[property="og:image"]')
      ?.getAttribute("content");

    return ogImage || null;
  });

    const rowLocator = page.locator('[data-testid="tracklist"] [data-testid="track-list-item"]');
    const rowCount = await rowLocator.count();

    const tracks = [];

    for (let i = 0; i < rowCount; i++) {
      const row = rowLocator.nth(i);

      const number = (
        await row.locator('[data-testid="track-number"]').first().textContent().catch(() => "")
      ).trim();

      const trackTitle = (
        await row.locator('[data-testid="track-title"]').first().textContent().catch(() => "")
      ).trim();

      const duration = (
        await row.locator('[data-testid="track-duration"]').first().textContent().catch(() => "")
      ).trim();

      if (!/^\d{1,3}$/.test(number)) continue;
      if (!trackTitle) continue;
      if (!/^\d{1,2}:\d{2}$/.test(duration)) continue;

      tracks.push({
        id: `apple-${number}`,
        title: trackTitle,
        duration,
      });
    }

    console.log("APPLE PLAYWRIGHT PARSE", {
      storefront,
      title: title?.trim() || null,
      artist: artist?.trim() || null,
      trackCount: tracks.length,
      firstTracks: tracks.slice(0, 5).map((t) => t.title),
    });

    return {
      title: title?.trim() || "Unknown Album",
      artist: artist?.trim() || "Unknown Artist",
      image,
      tracks,
      unavailable: false,
    };
  } finally {
    await page.close();
  }
}

function buildAppleDebug(byRegion, requestedRegions, preferredBaseRegion) {
  return {
    preferredBaseRegion,
    requestedRegions,
    byRegion: Object.fromEntries(
      requestedRegions.map((regionCode) => [
        regionCode,
        {
          unavailable: !!byRegion[regionCode]?.unavailable,
          title: byRegion[regionCode]?.title || null,
          artist: byRegion[regionCode]?.artist || null,
          image: byRegion[regionCode]?.image || null,
          trackCount: byRegion[regionCode]?.tracks?.length || 0,
        },
      ])
    ),
  };
}

async function scrapeAppleAlbumAcrossRegions(url, requestedRegions, preferredBaseRegion) {
  const parsed = parseAppleAlbumUrl(url);
  if (!parsed) {
    throw new Error("Invalid Apple Music album URL");
  }

  const storefrontMap = {
    JP: "jp",
    US: "us",
    ID: "id",
  };

  const regionEntries = await Promise.all(
    requestedRegions.map(async (regionCode) => {
      const storefront = storefrontMap[regionCode];
      const data = await scrapeAppleAlbumPage({
        storefront,
        slug: parsed.slug,
        albumId: parsed.albumId,
      });
      return [regionCode, data];
    })
  );

  const byRegion = Object.fromEntries(regionEntries);

  const availableRegions = requestedRegions.filter(
    (r) => !byRegion[r]?.unavailable
  );

  const baseRegion =
    preferredBaseRegion && availableRegions.includes(preferredBaseRegion)
      ? preferredBaseRegion
      : (availableRegions[0] || requestedRegions[0]);

  const baseAlbum = byRegion[baseRegion];

  if (!baseAlbum) {
    return {
      album: {
        id: parsed.albumId,
        title: null,
        artist: null,
        image: null,
        provider: "apple",
        baseRegion,
      },
      tracks: [],
      debug: buildAppleDebug(byRegion, requestedRegions, preferredBaseRegion),
    };
  }

  const baseTracks = baseAlbum.tracks || [];

  if (!baseTracks.length) {
    return {
      album: {
        id: parsed.albumId,
        title: baseAlbum.title,
        artist: baseAlbum.artist,
        image: baseAlbum.image,
        provider: "apple",
        baseRegion,
      },
      tracks: [],
      debug: buildAppleDebug(byRegion, requestedRegions, preferredBaseRegion),
    };
  }

  const tracks = baseTracks.map((baseTrack, index) => {
    const statuses = {};

    for (const regionCode of requestedRegions) {
      const regionAlbum = byRegion[regionCode];

      if (!regionAlbum || regionAlbum.unavailable || !regionAlbum.tracks?.length) {
        statuses[regionCode] = "unavailable";
        continue;
      }

      const exists = regionAlbum.tracks.some((t) => {
        const sameNumber =
          String(t.id || "").replace("apple-", "") ===
          String(baseTrack.id || "").replace("apple-", "");

        return sameNumber || titlesMatch(baseTrack.title, t.title);
      });

      statuses[regionCode] = exists ? "playable" : "unavailable";
    }

    return {
      id: baseTrack.id || `apple-${index + 1}`,
      title: baseTrack.title || `Track ${index + 1}`,
      duration: baseTrack.duration || "--:--",
      statuses,
    };
  });

  return {
    album: {
      id: parsed.albumId,
      title: baseAlbum.title,
      artist: baseAlbum.artist,
      image: baseAlbum.image,
      provider: "apple",
      baseRegion,
    },
    tracks,
    debug: buildAppleDebug(byRegion, requestedRegions, preferredBaseRegion),
  };
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.post("/api/check-album", async (req, res) => {
  try {
    const { provider, url, regions } = req.body;

    if (!provider || !url) {
      return res.status(400).json({
        error: "provider and url are required",
      });
    }

    if (provider === "apple") {
      const parsed = parseAppleAlbumUrl(url);

      const requestedRegions =
        Array.isArray(regions) && regions.length
          ? regions.filter((code) => ["JP", "US", "ID"].includes(code))
          : ["JP", "US", "ID"];

      const inputRegionMap = {
        jp: "JP",
        us: "US",
        id: "ID",
      };

      const preferredBaseRegion =
        inputRegionMap[parsed?.storefront] || requestedRegions[0];

      const result = await scrapeAppleAlbumAcrossRegions(
        url,
        requestedRegions,
        preferredBaseRegion
      );

      return res.json(result);
    }

    if (provider !== "spotify" && provider !== "apple") {
      return res.status(400).json({
        error: "Unsupported provider. Use spotify or apple.",
      });
    }

    const requestedRegions = Array.isArray(regions) && regions.length
      ? regions.filter((code) => REGION_MAP[code])
      : ["JP", "US", "ID"];

    const albumId = parseSpotifyAlbumId(url);

    if (!albumId) {
      return res.status(400).json({
        error: "Invalid Spotify album URL",
      });
    }

    const token = await getSpotifyAccessToken();

    const albumEntries = await Promise.all(
      requestedRegions.map(async (regionCode) => {
        const album = await fetchSpotifyAlbum(albumId, REGION_MAP[regionCode], token);
        return [regionCode, album];
      })
    );

    const albumByRegion = Object.fromEntries(albumEntries);

    const baseRegion = requestedRegions[0];
    const baseAlbum = albumByRegion[baseRegion];
    const baseTracks = baseAlbum?.tracks?.items || [];

    const tracks = baseTracks.map((baseTrack, index) => {
      const normalized = normalizeTrack(baseTrack, index);
      const statuses = {};

      for (const regionCode of requestedRegions) {
        const regionalTrack = albumByRegion[regionCode]?.tracks?.items?.[index] || null;
        statuses[regionCode] = mapSpotifyTrackStatus(regionalTrack);
      }

      return {
        ...normalized,
        statuses,
      };
    });

    return res.json({
      album: {
        id: baseAlbum?.id || albumId,
        title: baseAlbum?.name || "Unknown Album",
        artist:
          baseAlbum?.artists?.map((artist) => artist.name).join(", ") || "Unknown Artist",
        image: baseAlbum?.images?.[0]?.url || null,
        provider: "spotify",
      },
      tracks,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      error: error.message || "Internal server error",
    });
  }
});

process.on("SIGINT", async () => {
  if (browserPromise) {
    const browser = await browserPromise;
    await browser.close();
  }
  process.exit(0);
});

process.on("SIGTERM", async () => {
  if (browserPromise) {
    const browser = await browserPromise;
    await browser.close();
  }
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`Server running on http://127.0.0.1:${PORT}`);
});