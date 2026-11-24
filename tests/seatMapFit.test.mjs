import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateSeatMapFit } from '../lib/seatMapFit.js';

test('a wide monitor grows the map until height is exhausted', () => {
  const fit = calculateSeatMapFit({width:760,height:630,availableWidth:1300,availableHeight:900});
  assert.ok(fit.scale > 1);
  assert.ok(fit.scaledWidth <= 1300 && fit.scaledHeight <= 900);
  assert.ok(900 - fit.scaledHeight < 2);
  assert.equal(fit.needsHorizontalScroll || fit.needsVerticalScroll, false);
});
test('a narrow monitor uses width as the limiting dimension', () => {
  const fit = calculateSeatMapFit({width:760,height:630,availableWidth:640,availableHeight:800});
  assert.ok(fit.scale >= 0.75 && fit.scale < 1);
  assert.ok(640 - fit.scaledWidth < 2);
  assert.equal(fit.needsHorizontalScroll || fit.needsVerticalScroll, false);
});
test('minimum size wins on small screens and only the necessary axes scroll', () => {
  const narrow = calculateSeatMapFit({width:775,height:600,availableWidth:400,availableHeight:700});
  assert.equal(narrow.scale,0.75);
  assert.equal(narrow.needsHorizontalScroll,true);
  assert.equal(narrow.needsVerticalScroll,false);
  const short = calculateSeatMapFit({width:760,height:630,availableWidth:1000,availableHeight:300});
  assert.equal(short.scale,0.75);
  assert.equal(short.needsHorizontalScroll,false);
  assert.equal(short.needsVerticalScroll,true);
  assert.equal(short.viewportHeight,300);
});
test('fractional available sizes never introduce accidental scrollbars', () => {
  for (const [width,height] of [[775,600],[760,630],[920,650]]) {
    for (const scale of [0.75,0.8,1,1.333,1.75,2.5]) {
      const availableWidth=width*scale+0.4,availableHeight=height*scale+0.4;
      const fit=calculateSeatMapFit({width,height,availableWidth,availableHeight});
      assert.ok(fit.scaledWidth<=availableWidth+1);
      assert.ok(fit.scaledHeight<=availableHeight+1);
      assert.ok(fit.scale>=0.75);
    }
  }
});
test('fractional viewport height does not create a one-pixel scrollbar', () => {
  const fit=calculateSeatMapFit({width:760,height:630,availableWidth:1160,availableHeight:730.203125});
  assert.equal(fit.needsVerticalScroll,false);
  assert.ok(fit.scaledHeight<=fit.viewportHeight);
});
