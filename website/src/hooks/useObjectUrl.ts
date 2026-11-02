import { useEffect, useState } from "react";

export function useObjectUrl(blob: Blob | null): string | undefined {
  const [object, setObject] = useState<{ blob: Blob; url: string }>();
  useEffect(() => {
    if (!blob) {
      setObject(undefined);
      return;
    }
    const objectUrl = URL.createObjectURL(blob);
    setObject({ blob, url: objectUrl });
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);
  return object?.blob === blob ? object.url : undefined;
}
