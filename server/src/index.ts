import { SERVER_PORT } from "../../shared/src/constants";
import { Game } from "./game";

Game.start(SERVER_PORT).catch((err) => {
  console.error("failed to start server:", err);
  process.exit(1);
});
