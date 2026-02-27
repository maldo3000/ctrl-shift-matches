# ctrl-shift-matches

Static single-page site deployment for Ctrl Shift Matches.

## Preview locally

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the local static server:
   ```bash
   npm start
   ```
3. Open:
   ```
   http://localhost:3000
   ```

The page supports query parameters, for example:

```
http://localhost:3000?name=Sahil%20Lulla
```

## Deploy to Vercel

1. Install Vercel CLI (if needed):
   ```bash
   npm i -g vercel
   ```
2. From this project directory, deploy:
   ```bash
   vercel --prod
   ```

`vercel.json` rewrites all routes to `index.html`, so deep links and query-param URLs work correctly.

## Generate QR codes for guests

Use a bulk QR generator and provide URLs in this format:

```
https://yourdomain.com?name=Guest%20Name
```

For multiple guests, generate one URL per person (URL-encoded names), then export QR codes in bulk.
