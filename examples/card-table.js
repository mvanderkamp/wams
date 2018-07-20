/*
 * This example is intended to demonstrate how users can coordinate with the
 * workspace from several different angles.
 */

'use strict';

const WAMS = require('../src/server');

const main_ws = new WAMS.WorkSpace(
  9001, 
  {
    debug: false, 
    BGcolor: 'green',
    clientLimit: 5, // 4 players plus one for the table
  }
);
main_ws.addItem(new WAMS.Item(
  main_ws.getCenter().x, 
  main_ws.getCenter().y, 
  200, 
  282, 
  'joker',
  {
    imgsrc: 'joker.png'
  }
));

const draw = `function drawFunc() {
  ctx.beginPath();
  ctx.arc(
    ${main_ws.getCenter().x},
    ${main_ws.getCenter().y + 100},
    100,
    2 * Math.PI,
    false
  );
  ctx.fillStyle = 'white';
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#003300';
  ctx.stroke();
  ctx.font    = 'normal 36px Verdana';
  ctx.fillStyle = '#000000';
  ctx.fillText(
    'HTML5 Canvas Text', 
    ${main_ws.getCenter().x + 100}, 
    ${main_ws.getCenter().y + 100}
  );
};`;

main_ws.addItem(new WAMS.Item(
  main_ws.getCenter().x, 
  main_ws.getCenter().y, 
  500, 
  100,
  'text',
  {
    draw: draw.toString(), 
    drawStart: 'drawFunc()'
  }
));

const handleLayout = (function makeLayoutHandler() {
  let table = null;
  const TABLE   = 0;
  const BOTTOM  = 1;
  const LEFT    = 2;
  const TOP     = 3;
  const RIGHT   = 4;

  function layoutTable(workspace, viewer) {
    viewer.moveTo(
      workspace.getCenter().x,
      workspace.getCenter().y
    );
    table = viewer;
  };

  function layoutBottom(workspace, viewer) {
    viewer.moveTo(
      table.left(),
      table.bottom()
    );
  };

  function layoutLeft(workspace, viewer) {
    viewer.rotation = Math.PI;
    viewer.moveTo(
      table.left(),
      (table.top() - viewer.effectiveHeight)
    );
  };

  function layoutTop(workspace, viewer) {
    viewer.rotation = 3*Math.PI/2;
    viewer.moveTo(
      (table.left() - viewer.effectiveWidth),
      table.top()
    );
  };

  function layoutRight(workspace, viewer) {
    viewer.rotation = Math.PI/2;
    viewer.moveTo(
      table.right(),
      table.top()
    );
  };
  
  const user_fns = [];
  user_fns[TABLE]   = layoutTable;
  user_fns[BOTTOM]  = layoutBottom;
  user_fns[LEFT]    = layoutLeft;
  user_fns[TOP]     = layoutTop;
  user_fns[RIGHT]   = layoutRight;

  function handleLayout(workspace, viewer) {
    const index = workspace.views.length;
    if (index <= 4) {
      user_fns[index](workspace, viewer);
    }
  }

  return handleLayout;
})();

const handleDrag = (function makeDragHandler() {
  function isItem(tgt) {
    return tgt.type === 'joker' || target.type === 'text';
  }

  function handleDrag(target, viewer, x, y, dx, dy) {
    if (target.type === 'view/background') {
      viewer.moveBy(dx, dy);
    } else if (isItem(target)) {
      // Needs negative values because dx/dx are change from 
      //  origin of drag
      target.moveBy(-dx, -dy);  
    }
  }

  return handleDrag;
})();

const handleScale = function(viewer, newScale) {
  viewer.rescale(newScale);
}

const handleClick = (function makeClickHandler() {
  let faceUp = true;

  function handleClick(target, viewer, x, y) {
    if (target.type === 'joker') {
      const imgsrc = faceUp ? 'card-back.png' : 'joker.png';
      target.assign({imgsrc});
      faceUp = !faceUp;
    }
  }

  return handleClick;
})();

main_ws.attachClickHandler(handleClick);
main_ws.attachScaleHandler(handleScale);
main_ws.attachDragHandler(handleDrag);
main_ws.attachLayoutHandler(handleLayout);

main_ws.listen();

// const second_ws = new WAMS.WorkSpace(
//   9501,
//   {
//     debug : false,
//     BGcolor: 'blue',
//     bounds: {
//       x: 1000,
//       y: 1000,
//     },
//     clientLimit: 5, // 4 players plus one for the table
//   }
// );
// main_ws.addSubWS(second_ws);

