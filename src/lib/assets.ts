"use client";

import { useEffect, useState } from "react";
import { uid } from "./seed";

/**
 * Moodboard image store. Files are downscaled and kept in this browser's
 * IndexedDB; the document only holds their ids, so localStorage stays small
 * and undo/redo never copies image data.
 */

const DB_NAME = "form-assets";
const STORE = "images";
const MAX_SIDE = 1600;

let dbPromise: Promise<IDBDatabase> | null = null;
const urls = new Map<string, string>();

function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function put(id: string, blob: Blob) {
  const d = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = d.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(blob, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function get(id: string): Promise<Blob | null> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const req = d.transaction(STORE).objectStore(STORE).get(id);
    req.onsuccess = () => resolve((req.result as Blob | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function assetUrl(id: string): Promise<string | null> {
  const cached = urls.get(id);
  if (cached) return cached;
  const blob = await get(id).catch(() => null);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urls.set(id, url);
  return url;
}

/** Object URL for a stored image; null while loading, or if this browser doesn't have it. */
export function useAssetUrl(id: string | null): { url: string | null; missing: boolean } {
  const [state, setState] = useState<{ id: string | null; url: string | null; missing: boolean }>({ id: null, url: null, missing: false });
  useEffect(() => {
    if (!id) return;
    let alive = true;
    assetUrl(id).then((url) => alive && setState({ id, url, missing: !url }));
    return () => {
      alive = false;
    };
  }, [id]);
  return state.id === id ? { url: state.url, missing: state.missing } : { url: urls.get(id ?? "") ?? null, missing: false };
}

export const isImageFile = (f: File) => f.type.startsWith("image/");

/** Downscales an image file, stores it, and returns its id and natural proportions (h / w). */
export async function ingestImage(file: File): Promise<{ asset: string; aspect: number }> {
  const asset = uid("img");
  let blob: Blob = file;
  let aspect = 0.75;
  try {
    const bmp = await createImageBitmap(file);
    aspect = bmp.height / bmp.width;
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const encode = (type: string) => new Promise<Blob | null>((res) => canvas.toBlob(res, type, 0.86));
    // WebP where the browser can encode it, JPEG otherwise (Safari falls back to PNG for WebP)
    const webp = await encode("image/webp");
    blob = webp?.type === "image/webp" ? webp : ((await encode("image/jpeg")) ?? file);
  } catch {
    // Formats the canvas can't decode (e.g. some SVGs) are kept as they are
  }
  await put(asset, blob);
  urls.set(asset, URL.createObjectURL(blob));
  return { asset, aspect: Math.min(Math.max(aspect, 0.2), 4) };
}
