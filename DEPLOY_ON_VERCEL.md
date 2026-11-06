# Deploy UNSPOKEN from your own accounts

You need a GitHub account, a Vercel account, and a Neon PostgreSQL database. No ChatGPT account is needed to play your public production deployment.

## 1. Extract the ZIP

Extract the download. Open the `UNSPOKEN` folder. It contains `package.json`, `app`, `components`, `lib`, `public`, and the deployment files.

## 2. Create a GitHub repository

1. Open GitHub and create a repository, for example `unspoken`.
2. Use **Add file → Upload files**.
3. Upload the **contents** of the extracted `UNSPOKEN` folder.
4. Commit the upload.

`package.json` should be at the repository root. Upload the extracted files, not the ZIP itself. Never upload a real `.env.local`, database password, account token, or `node_modules` folder. The empty `.env.example` is safe to include.

## 3. Create your database

1. Open <https://console.neon.tech/> and create a PostgreSQL project.
2. Choose a region near the Vercel function region you will use.
3. Open **Connect** and copy your PostgreSQL connection string.
4. Keep the connection string private. It contains the database password.

Alternatively, provision Neon through Vercel's Storage / Marketplace integration and connect it to this project.

The game creates its `rooms` table and expiry index automatically on the first valid API request. A separate SQL command is not required. The database role must be allowed to create that table and index.

## 4. Import into Vercel

1. Open <https://vercel.com/new>.
2. Import your `unspoken` GitHub repository.
3. Set the framework to **Next.js** if it is not detected automatically.
4. Leave Root Directory at the repository root, where `package.json` is located.
5. Use Node.js **22.x** or newer if a version choice is shown.
6. Keep the provided install command `npm ci` and build command `npm run build`.
7. Leave Output Directory at the Next.js default. Do not set it to `dist`, `out`, or `public`.

If you uploaded the outer `UNSPOKEN` folder instead of its contents, choose that folder as Root Directory.

## 5. Add the private environment variable

In the project's environment variables, add:

```text
Name:  DATABASE_URL
Value: your own Neon PostgreSQL connection string
```

Enable it for **Production**. Enable it for Preview and Development only when you want those environments to connect to a database too. A separate Neon branch/database is preferable for previews.

If the integration supplies a differently named connection string, add `DATABASE_URL` with that value. This app reads `DATABASE_URL`.

Do not name it `NEXT_PUBLIC_DATABASE_URL`. Do not paste it into frontend files or commit it to GitHub.

## 6. Deploy

Click **Deploy**. After it finishes, open the **Production** URL.

If you add or change an environment variable after deployment, redeploy so the running application receives it.

Your frontend and `/api/game` backend share the same origin. There is no separate backend URL, Firebase configuration, or CORS allowlist to set up.

## 7. Verify public access and multiplayer

Open the production URL on your phone and in a private browser window. If visitors see a Vercel sign-in page, check the project's Deployment Protection settings and allow public access to the production site.

Then test with four separate browser profiles, private sessions, or physical devices:

1. Host creates a party.
2. Three friends join using its six-digit code.
3. Everyone selects and locks their gender.
4. Start the gender check; inspect each name and blue/pink phone screen.
5. Test **Redo names & genders** once, then finish the check again.
6. Everyone taps ready; the host starts anonymity.
7. Everyone writes a question.
8. Answer every question, verify the drumroll and aggregate results, and move to the next question.
9. Finish the round and return to the lobby.

Avoid testing different players in ordinary tabs that share the same browser storage. Different profiles/devices represent separate players correctly.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Create party cannot connect | `DATABASE_URL` exists in the deployed environment, the Neon project is available, and the app was redeployed after changing the value. |
| Database setup fails | The connection string is a Neon PostgreSQL URL, TLS options were retained, and the role may create tables/indexes. |
| Build cannot find `package.json` | Root Directory points to the folder containing it. |
| Friends see Vercel login | Use the public production URL and check Deployment Protection. |
| Result is withheld | At least three eligible players must submit; missing tally devices also cause results to be withheld. |
| Round ends safely after disconnect | Keep every participating phone open during the encrypted shuffle and tally. |
| No sound | Tap the page first and make sure the sound toggle and device volume are on. Browser autoplay rules require a gesture. |

Rooms expire after two hours. Expired rows are deleted on the next valid game request; round questions/results are cleared at completion. There are no seeded demo players or production credentials in this download.

## Reference documentation

- Next.js on Vercel: <https://vercel.com/docs/frameworks/full-stack/nextjs>
- Neon serverless PostgreSQL driver: <https://neon.com/docs/serverless/serverless-driver>
- Vercel environment variables: <https://vercel.com/docs/environment-variables>

See `PRIVACY.md` before changing the question or voting data flow.
