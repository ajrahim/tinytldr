import { readMediaBlob, readMediaLibrary } from "../src/lib/MediaLibrary.js";
import { requireFirebaseAuth } from "../src/lib/FirebaseClient.js";

export async function inspectLibrary() {
  const uid = requireFirebaseAuth().currentUser!.uid;
  const items = await readMediaLibrary(uid);
  return Promise.all(
    items.map(async (item) => {
      const { metadata, source } = item;
      const file = await readMediaBlob(item, "file", uid, new AbortController().signal);
      const poster = await readMediaBlob(item, "poster", uid, new AbortController().signal);
      const bytes = new Uint8Array(await file.arrayBuffer());
      let pixel: number[] | undefined;
      if (metadata.format === "png") {
        const image = await createImageBitmap(file);
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas context unavailable");
        context.drawImage(image, 0, 0);
        pixel = Array.from(context.getImageData(0, 0, 1, 1).data);
        image.close();
      }
      const thumbnail = await createImageBitmap(poster);
      const posterSize = { width: thumbnail.width, height: thumbnail.height };
      thumbnail.close();
      return { metadata, source, type: file.type, bytes: Array.from(bytes), pixel, posterSize };
    }),
  );
}
