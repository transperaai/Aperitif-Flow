/// <reference lib="webworker" />
// One worker of the robustness pool: runs a job (a perturbation's replications, both sides) and posts its result back.
import { handleRobustnessRequest, type RobustnessRequest } from "@transpera-flow/engine";

self.onmessage = (event: MessageEvent<RobustnessRequest>) => {
  self.postMessage(handleRobustnessRequest(event.data));
};
