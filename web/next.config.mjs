const basePath = process.env.NEXT_BASE_PATH ?? '/policypilot-monad';
export default { output: 'export', basePath, trailingSlash: true, images: { unoptimized: true }, env: { NEXT_PUBLIC_BASE_PATH: basePath } };
