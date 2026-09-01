# Photography image delivery

Verified against Cloudflare's documentation on 2026-08-24.

## Recommendation for this site

Keep the portfolio on **Workers Static Assets** for now. The site already
deploys `dist/` that way, and Astro turns each source photograph into four
content-hashed WebP files at 480, 760, 1120, and 1600 pixels wide. Static asset
requests are free and unlimited, and Cloudflare does not add a storage charge
for Assets.

`public/_headers` gives `/_astro/*` a one-year immutable browser cache. The
filenames contain a content hash, so replacing a photograph creates new URLs
and cannot leave visitors with a stale image. Cloudflare's Workers asset tier
also caches these files across its network.

Current Free-plan limits relevant to this deployment:

- 20,000 static asset files per Worker version.
- 25 MiB maximum for any one deployed static asset.
- No additional charge for Assets storage.
- Static asset requests are free and unlimited.

Sources: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/),
[Static Assets billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/),
and [custom response headers](https://developers.cloudflare.com/workers/static-assets/headers/).

## Portfolio size budgets

The 25 MiB limit is **per generated file**, not a storage pool divided among
the photographs. With four variants per photograph, even 100 photographs use
only 400 of the 20,000 file allowance (plus the site's other assets).

These are useful quality/performance targets for the largest 1600px WebP, not
hard Cloudflare limits. Smaller variants will usually be much lighter.

| Portfolio | Generated files | Hard limit per generated file | Target for the 1600px file | Full-scroll upper target |
| ---: | ---: | ---: | ---: | ---: |
| 5 photos | 20 | 25 MiB | 1.5 MiB | 7.5 MiB |
| 10 photos | 40 | 25 MiB | 1 MiB | 10 MiB |
| 50 photos | 200 | 25 MiB | 600 KiB | ~30 MiB |
| 100 photos | 400 | 25 MiB | 400 KiB | ~40 MiB |

The current six-image build is comfortably below these targets: the largest
1600px output is about 284 KiB. Only the first photo is requested eagerly; the
rest use native lazy loading.

For replacements, retain full-resolution masters outside the repository and
export a high-quality JPEG or PNG source for the site. The component caps the
served output at 1600px and quality 82, so a larger source improves the resize
without making the delivered image master-sized. Aim for a source under about
10 MiB to keep Git and CI builds pleasant; this is an operational target, not
a Cloudflare limit.

At 50–100 photos, loading behavior and navigation matter before storage does.
Keep the single `/photography` route, but consider a later "load more" boundary,
filters, or an accessible lightbox so visitors do not need to traverse the
entire archive at once.

## When to move photographs to R2

R2 is useful later if the portfolio needs downloadable originals, frequent
uploads independent of site deploys, or enough media that keeping it in Git is
awkward. R2's Free tier currently includes 10 GB-month of Standard storage,
1 million Class A operations, 10 million Class B operations, and free egress.

If that move happens:

1. Store originals in R2 using versioned/immutable object keys.
2. Attach a custom domain such as `media.builtbywoodley.ca`; the `r2.dev`
   development URL does not support Cloudflare Cache.
3. Send `Cache-Control: public, max-age=31536000, immutable` on versioned files.
4. Use Cloudflare Image Transformations for a small fixed set of widths instead
   of serving originals. The Images Free plan includes 5,000 unique
   transformations per month, enough for 100 photos at four sizes (400 unique
   transformations) with ample room.

The raw 10 GB R2 allowance would divide to 2 GB, 1 GB, 200 MB, or 100 MB per
original at 5, 10, 50, or 100 photos respectively. Those are theoretical
storage ceilings, not sensible web sizes: remote Image Transformations accept
source images up to 100 MB, and Cloudflare's Free-plan CDN cache limit is
512 MB per file. Normal photographic masters should remain far below either.

Sources: [R2 pricing](https://developers.cloudflare.com/r2/pricing/),
[R2 custom-domain caching](https://developers.cloudflare.com/cache/interaction-cloudflare-products/r2/),
[Images pricing](https://developers.cloudflare.com/images/pricing/),
[Images limits](https://developers.cloudflare.com/images/get-started/limits/),
and [CDN cacheable file limits](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/).
