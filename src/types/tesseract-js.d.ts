declare module "tesseract.js" {
  export function createWorker(
    langs?: string,
    oem?: unknown,
    options?: Record<string, unknown>,
  ): Promise<{
    recognize: (image: string) => Promise<any>;
    setParameters: (params: Record<string, unknown>) => Promise<void>;
    terminate: () => Promise<void>;
  }>;
}
