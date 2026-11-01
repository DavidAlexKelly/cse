# plan-prepare-widgets

This project was generated with [`@osdk/create-widget`](https://www.npmjs.com/package/@osdk/create-widget) and demonstrates developing custom widgets to be embedded within Foundry UIs such as Workshop. It uses the Ontology SDK package @custom-widget/sdk with React on top of Vite. Check out the [Vite](https://vitejs.dev/guide/) docs for further configuration. The Vite plugin [`@osdk/widget.vite-plugin`](https://www.npmjs.com/package/@osdk/widget.vite-plugin) automatically generates a `widgets.config.json` manifest file containing metadata about widgets inside this project during the build command.

## Shared styling (Mission Control design system)

Every widget in this set shares one design system so the apps look like a single
product when they are composed together in Workshop.

**Import the shared entry point first, then your widget stylesheet:**

```ts
import "../shared/styling/index.css"; // tokens + components + surfaces
import "./myWidget.css";              // widget-specific overrides
```

`src/shared/styling/` contains:

| File | Purpose |
| --- | --- |
| `index.css` | The single entry point every widget imports. |
| `global.css` | Design tokens (`:root` CSS variables), reset, Blueprint dark overrides. |
| `theme.ts` | The same tokens as TypeScript constants, for inline styles. |
| `surfaces.css` | `.mc-*` Mission Control primitives: app shell, cards, pills, nav items, tabs, metrics, log rows. |
| `components.css` | Styles for the shared React components (`MilButton`, `MilLabel`, `MilList`, `MilModal`). |
| `ui-redesign.css` | Shared hero / badge / list patterns. |
| `task-page.css` | Shared page chrome for the scenario-style pages. |
| `animations.css` | Shared keyframes. |

**Palette:** deep navy backgrounds (`--bg-base` … `--bg-raised`), indigo/violet
primary accent (`--accent-primary`), violet (`--accent-violet`), teal
(`--accent-cyan`), mint green (`--accent-green`), amber and red for status.
The indigo → violet → teal rule (`--accent-violet-grad`) is rendered across the
top of every widget shell (`.mc-app`, `.mil-widget`, the header and sidebar).

**Rules of thumb**

- Never hard-code hex colours — use `var(--token)` in CSS or `colors.*` from
  `theme.ts` in TSX.
- Use the `.mc-*` primitives (`.mc-card`, `.mc-pill--green`, `.mc-nav-item`,
  `.mc-panel`, `.mc-metric`, `.mc-log-row`) before writing new panel/badge CSS.
- Corner radii come from `--radius-sm|md|lg|xl|pill`; badges and buttons are pills.

## Developing locally

A `FOUNDRY_TOKEN` environment variable is required to authenticate with the NPM registry and to start developer mode for the custom widget set. When developing locally you may use the token provided by the [Palantir VS Code extension](https://www.palantir.com/docs/foundry/palantir-extension-for-visual-studio-code/overview), or generate a longer lived token [inside Foundry](https://www.palantir.com/docs/foundry/platform-security-third-party/user-generated-tokens/#generation).

Install project dependencies:

```sh
npm install
```

> **Note:** Custom widget npm library versions are not automatically updated in this repository due to the lockfile dependency versions in `package-lock.json`. This ensures builds are reproducible across developers and Foundry CI. To receive the latest features and bug fixes, periodically update library versions manually by running:
> ```sh
> npm install @osdk/widget.client-react@latest @osdk/widget.client@latest @osdk/widget.vite-plugin@latest
> ```

Run the following command from the project root to start a local development server:

```sh
npm run dev
```

Follow the instructions printed to the console to set up developer mode in Foundry. This will allow you to test your widgets in Workshop or other Foundry applications while developing.

## Developing with Code Workspaces

Run the following command in a VS Code workspace terminal from the project root to start a development server on the workspace:

```sh
npm run dev:remote
```

Follow the instructions printed to the console to set up developer mode in Foundry. Use the preview panel in Code Workspaces and select your widget to preview your changes.

## Deploying

> **Note:** An initial version of your widget set has already been deployed when this repository was created. You only need to follow these steps when deploying updates.

This project uses Foundry CI to automatically deploy production builds whenever git tags are pushed.

### Automatic deployment via git tags

Simply create and push a git tag to trigger a deployment:

```sh
git tag <x.y.z>
git push origin tag <x.y.z>
```