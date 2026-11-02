import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Vitest is not run in `globals` mode, so Testing Library's own automatic
// afterEach(cleanup) never registers; without this, DOM from one test leaks
// into the next.
afterEach(cleanup);
