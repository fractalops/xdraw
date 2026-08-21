import assert from "node:assert/strict";
import test from "node:test";

import { ConnectorLabelFitError, placeConnectorLabel } from "../src/routing/labels.ts";

const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

test("a label on a horizontal run sits clear of the segment it names", () => {
  const from = box(0, 0, 200, 100);
  const to = box(500, 0, 200, 100);
  const placed = placeConnectorLabel({
    label: "sends",
    path: [[200, 50], [500, 50]],
    fromBounds: from,
    toBounds: to,
  });
  // Centred on the run, and above it rather than across it.
  assert.equal(placed.x + placed.width / 2, 350);
  assert.ok(placed.y + placed.height < 50, "label overlaps the segment");
  assert.ok(placed.x > from.x + from.width, "label overlaps the source shape");
  assert.ok(placed.x + placed.width < to.x, "label overlaps the target shape");
  assert.equal(placed.text, "sends");
});

test("a label on a vertical run sits in the gap beside the arrow", () => {
  // 60px of gap, which is more than a two-line label needs.
  const from = box(0, 0, 400, 100);
  const to = box(0, 160, 400, 100);
  const placed = placeConnectorLabel({
    label: "waits only",
    path: [[200, 100], [200, 160]],
    fromBounds: from,
    toBounds: to,
  });
  assert.ok(placed.y >= 100 && placed.y + placed.height <= 160, "label left the gap");
  assert.ok(placed.x + placed.width <= 200, "label crosses the arrow");
  assert.ok(placed.x >= from.x, "label escaped the shapes it sits between");
});

test("a gap too short for the text reports the clearance layout must reserve", () => {
  const from = box(0, 0, 400, 100);
  const to = box(0, 120, 400, 100);
  assert.throws(() => placeConnectorLabel({
    label: "waits only", path: [[200, 100], [200, 120]], fromBounds: from, toBounds: to, maxWidth: 60,
  }), (error) => error instanceof ConnectorLabelFitError && error.requiredClearance > 20);
});

test("an obstacle on the near side moves the label to the far side", () => {
  const from = box(0, 0, 200, 100);
  const to = box(500, 0, 200, 100);
  const request = {
    label: "sends",
    path: [[200, 50], [500, 50]] as [number, number][],
    fromBounds: from,
    toBounds: to,
  };
  const clear = placeConnectorLabel(request);
  // Cover the position it chose; it should take the other one rather than stay.
  const blocked = placeConnectorLabel({
    ...request,
    obstacles: [box(clear.x - 5, clear.y - 5, clear.width + 10, clear.height + 10)],
  });
  assert.notDeepEqual([blocked.x, blocked.y], [clear.x, clear.y]);
  assert.ok(blocked.y > clear.y, "expected the label to move to the other side of the run");
});

test("a label wraps to the width it is given, and grows taller for it", () => {
  const placed = placeConnectorLabel({
    label: "reads it and waits for it",
    path: [[100, 50], [400, 50]],
    fromBounds: box(0, 0, 100, 100),
    toBounds: box(400, 0, 100, 100),
    maxWidth: 60,
  });
  assert.equal(placed.width, 60);
  assert.ok(placed.text.includes("\n"), "expected the label to wrap");
  assert.equal(placed.height, placed.text.split("\n").length * 15 * 1.25);
});

test("a blocked leg is reported instead of detaching its label", () => {
  const request = {
    label: "reads it and waits for it",
    path: [[100, 50], [220, 50]] as [number, number][],
    fromBounds: box(0, 0, 100, 100),
    toBounds: box(220, 0, 100, 100),
  };
  assert.throws(() => placeConnectorLabel(request), ConnectorLabelFitError);
});

test("the longest leg of a routed path is the one labelled", () => {
  const from = box(0, 0, 100, 60);
  const to = box(0, 400, 100, 60);
  // Short hop right, long run down, short hop back: the descent is the only leg
  // with room, so the label belongs beside it.
  const placed = placeConnectorLabel({
    label: "then",
    path: [[100, 30], [300, 30], [300, 430], [100, 430]],
    fromBounds: from,
    toBounds: to,
  });
  assert.ok(Math.abs(placed.y + placed.height / 2 - 230) < 1, "label is not on the descent");
});
