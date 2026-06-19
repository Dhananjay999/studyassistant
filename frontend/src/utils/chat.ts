export const createMessageId = (): string => crypto.randomUUID();

export const isValidMessage = (content: string): boolean =>
  content.trim().length > 0;

export const isValidFile = (file: File): boolean => {
  const isPdf =
    file.type === "application/pdf" ||
    file.name.toLowerCase().endsWith(".pdf");
  const isImage = file.type.startsWith("image/");
  return (isPdf || isImage) && file.size > 0;
};
