# Voxel Portal

A small browser bridge that uses `mineflayer` so you can sign in with a Microsoft account, connect to a block server, move around from the browser, break blocks, activate a nearby crafting table, inspect inventory contents, equip held items, and trigger simple crafting jobs.

## What is included

- Microsoft account sign-in handled through `mineflayer` on the server side.
- A live first-person world stream powered by `prismarine-viewer`.
- Browser controls for movement, jump, sprint, sneak, and camera look.
- Actions for breaking the targeted block and activating the targeted block.
- Inventory listing with one-click equip-to-hand.
- Craftable item suggestions plus basic nearby-table crafting.

## Start

```bash
npm install
npm start
```

Then open `http://localhost:3000`.

The live view is served from `http://localhost:3001`.

## Notes

- The first sign-in opens the Microsoft device flow in the terminal where the bot process is running.
- Crafting requires the recipe ingredients to already be in your inventory.
- Crafting-table recipes require a reachable crafting table within six blocks.
- This is a lightweight remote-control bridge, not a full native client replacement.
