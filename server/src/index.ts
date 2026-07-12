import http from "node:http";
import { SERVER_PORT } from "../../shared/src/constants";

console.log("Dash City server starting");

const server = http.createServer();
server.listen(SERVER_PORT, () => {
  console.log(`listening on :${SERVER_PORT}`);
});
