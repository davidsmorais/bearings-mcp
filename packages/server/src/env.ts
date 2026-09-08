/** Validates required environment variables before the server accepts connections. */
export function assertRequiredEnv(): void {
  if (!process.env.GEOAPIFY_API_KEY?.trim()) {
    console.error("GEOAPIFY_API_KEY environment variable is required but not set");
    process.exit(1);
  }
}
