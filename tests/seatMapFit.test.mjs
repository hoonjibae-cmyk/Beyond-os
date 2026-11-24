import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateSeatMapFit, getDashboardSeatMapHeight } from '../lib/seatMapFit.js';

test('a wide monitor caps the map at 125 percent', () => {
  const fit = calculateSeatMapFit({width:760,height:630,availableWidth:2400,availableHeight:1600});
  assert.equal(fit.scale,1.25);
  assert.equal(64 * fit.scale,80);
  assert.equal(fit.scaledWidth,950);
  assert.equal(fit.scaledHeight,788);
  assert.equal(fit.needsHorizontalScroll || fit.needsVerticalScroll, false);
});

test('height limits the map before the maximum scale when necessary', () => {
  const fit = calculateSeatMapFit({width:760,height:630,availableWidth:1300,availableHeight:730});
  assert.ok(fit.scale > 1 && fit.scale < 1.25);
  assert.ok(fit.scaledWidth <= 1300 && fit.scaledHeight <= 730);
  assert.ok(730 - fit.scaledHeight < 2);
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

test('opening or growing alerts never shrinks the map or adds an internal scrollbar', () => {
  for (const [width,height] of [[775,600],[760,630]]) {
    const baseline = calculateSeatMapFit({ width,height,availableWidth:width*1.25,availableHeight:1000 });
    for (const alertHeight of [0,160,550,1200]) {
      const availableHeight=getDashboardSeatMapHeight({availableBottom:1440,headerBottom:100,workspaceTop:100+alertHeight,mapTop:260+alertHeight});
      assert.deepEqual(calculateSeatMapFit({width,height,availableWidth:width*1.25,availableHeight}),baseline);
    }
  }
});

test('screen resize still fits the map even when alerts start expanded', () => {
  const makeFit=(screenHeight,availableWidth)=>calculateSeatMapFit({width:775,height:600,availableWidth,
    availableHeight:getDashboardSeatMapHeight({availableBottom:screenHeight,headerBottom:90,workspaceTop:890,mapTop:1040})});
  assert.equal(makeFit(1440,970).scale,1.25);
  const smaller=makeFit(900,700);
  assert.ok(smaller.scale>0.75&&smaller.scale<1.25);
  assert.equal(smaller.needsHorizontalScroll||smaller.needsVerticalScroll,false);
});
