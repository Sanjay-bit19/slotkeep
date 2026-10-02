import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: ["/", "/b/"], disallow: ["/dashboard", "/m/", "/dev/", "/api/"] },
    ],
  };
}
