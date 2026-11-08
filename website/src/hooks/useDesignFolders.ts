import { useCallback, useEffect, useState } from "react";
import type { DesignFolder, DesignFolderColor } from "@tinytldr/core";
import {
  colorDesignFolder,
  createDesignFolder,
  deleteDesignFolder,
  listDesignFolders,
  moveDesignToFolder,
  renameDesignFolder,
} from "../lib/DesignRepository.js";

export interface DesignFolders {
  folders: readonly DesignFolder[];
  busy: boolean;
  error: string | null;
  clearError: () => void;
  create: (name: string) => Promise<boolean>;
  rename: (folderId: string, name: string) => Promise<boolean>;
  recolor: (folderId: string, color: DesignFolderColor | null) => Promise<boolean>;
  remove: (folderId: string) => Promise<boolean>;
  move: (designId: string, folderId: string | null) => Promise<boolean>;
}

function sortFolders(folders: DesignFolder[]) {
  return folders.sort(
    (a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) ||
      a.created_at.localeCompare(b.created_at),
  );
}

/** Account folders are loaded with the account design list and refreshed with it. */
export function useDesignFolders(userId: string | undefined, version: number): DesignFolders {
  const [folders, setFolders] = useState<DesignFolder[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setFolders([]);
    if (!userId) return;
    void listDesignFolders()
      .then((next) => {
        if (active) setFolders(next);
      })
      .catch((err: unknown) => {
        if (active) setError(`Folders could not be loaded: ${message(err)}`);
      });
    return () => {
      active = false;
    };
  }, [userId, version]);

  const run = useCallback(async (label: string, operation: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await operation();
      return true;
    } catch (err) {
      setError(`${label}: ${message(err)}`);
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const create = useCallback(
    (name: string) =>
      run("Folder could not be created", async () => {
        const folder = await createDesignFolder(name);
        setFolders((current) =>
          sortFolders([...current.filter((item) => item.id !== folder.id), folder]),
        );
      }),
    [run],
  );
  const rename = useCallback(
    (folderId: string, name: string) =>
      run("Folder could not be renamed", async () => {
        const folder = await renameDesignFolder(folderId, name);
        setFolders((current) =>
          sortFolders(current.map((item) => (item.id === folder.id ? folder : item))),
        );
      }),
    [run],
  );
  const recolor = useCallback(
    (folderId: string, color: DesignFolderColor | null) =>
      run("Folder color could not be changed", async () => {
        const folder = await colorDesignFolder(folderId, color);
        setFolders((current) => current.map((item) => (item.id === folder.id ? folder : item)));
      }),
    [run],
  );
  const remove = useCallback(
    (folderId: string) =>
      run("Folder could not be deleted", async () => {
        await deleteDesignFolder(folderId);
        setFolders((current) => current.filter((item) => item.id !== folderId));
      }),
    [run],
  );
  const move = useCallback(
    (designId: string, folderId: string | null) =>
      run("Design could not be moved", async () => {
        setFolders(await moveDesignToFolder(designId, folderId));
      }),
    [run],
  );

  return {
    folders,
    busy,
    error,
    clearError: useCallback(() => setError(null), []),
    create,
    rename,
    recolor,
    remove,
    move,
  };
}

function message(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}
