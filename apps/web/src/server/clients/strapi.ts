// apps/web/src/server/clients/strapi.ts
import { env } from '../env'

async function get<T>(path: string): Promise<T> {
    const res = await fetch(`${env.STRAPI_URL}/api${path}`, {
        headers: { Authorization: `Bearer ${env.STRAPI_API_TOKEN}` },
    })
    if (!res.ok) throw new Error(`Strapi ${res.status}: ${path}`)
    return res.json()
}

export const strapi = {
    getProductContent: (slug: string) =>
        get(`/product-contents?filters[slug][$eq]=${encodeURIComponent(slug)}&populate=*`),
}