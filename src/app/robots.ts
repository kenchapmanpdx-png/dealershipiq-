import { MetadataRoute } from 'next';
import { getAppUrl } from '@/lib/url';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/dashboard/'],
    },
    sitemap: `${getAppUrl()}/sitemap.xml`,
  };
}
