/*
 * WAMS - An API for Multi-Surface Environments
 *
 * Original author: Jesse Rolheiser
 * Revised by: Scott Bateman
 * Latest edition by: Michael van der Kamp
 *  |-> Date: July/August 2018
 */

//TODO: Update canvas to work more like this for drawings: 
// https://simonsarris.com/making-html5-canvas-useful/
//TODO: Stretch goal is to incorporate a canvas library: 
// http://danielsternlicht.com/playground/html5-canvas-libraries-comparison-table/
//TODO: Allow subcanvas to be drawn on top: 
// https://stackoverflow.com/questions/3008635/html5-canvas-element-multiple-layers

'use strict';

/*
 * XXX: BUG! Disconnects aren't actually disconnecting!!!
 */

/*
 * XXX: Look into socket.io 'rooms', as they look like the kind of thing that
 *    might make some of this work a lot easier.
 */
const express = require('express');
const http = require('http');
const io = require('socket.io');
const path = require('path')
const WamsShared = require('./shared.js');

/*
 * I'm using a frozen 'globals' object with all global constants and variables 
 * defined as properties on it, to make global references explicit. I've been 
 * toying with this design pattern in my other JavaScript code and I think I 
 * quite like it.
 */
const globals = (function defineGlobals() {
  const rv = {};
  const constants = {
    OBJ_ID_STAMPER: new WamsShared.IDStamper(),
  };

  Object.entries(constants).forEach( ([p,v]) => {
    Object.defineProperty(rv, p, {
      value: v,
      configurable: false,
      enumerable: true,
      writable: false
    });
  });

  /*
   * I centralized some constant descriptions in the shared file, so collect 
   * them from there.
   */
  Object.entries(WamsShared.constants).forEach( ([p,v]) => {
    Object.defineProperty(rv, p, {
      value: v,
      configurable: false,
      enumerable: true,
      writable: false
    });
  });

  return Object.freeze(rv);
})();

const WorkSpace = (function defineWorkSpace() {
  /*
   * This 'locals' object defines some values and functions that will be used
   * by the class definition. Because it is specified here inside an IIFE, only
   * one instance of this locals object will ever exist, and its contents will
   * be private (unless deliberately exposed) to the WorkSpace class
   * definition.
   *
   * Think of these as 'private constants and functions'.
   */
  const locals = Object.freeze({
    DEFAULTS: Object.freeze({
      debug: false,
      color: '#aaaaaa',
      bounds: {
        x: 10000,
        y: 10000,
      },
      clientLimit: 10,
    }),

    HANDLER_FACTORY: Object.freeze({
      click(listener) {
        return function handleClick(viewspace, x, y) {
          const target = this.findObjectByCoordinates(x,y) || this;
          listener(target, viewspace, x, y);
        };
      },

      drag(listener) {
        return function handleDrag(viewspace, x, y, dx, dy) {
          /*
           * XXX: This is causing jitter. Will have to look in the 
           *    debugger, perhaps multiple events are firing on drags.
           *
           *    The source of the jitter seems to be when the 
           *    background is dragged.
           */
          const target = this.findObjectByCoordinates(x,y) || this;
          listener(target, viewspace, x, y, dx, dy);
        };
      },

      layout(listener) {
        return function handleLayout(viewspace) {
          if (this.addUser(viewspace)) {
            listener(this, viewspace);
            return true;
          }
          return false;
        };
      },

      scale(listener) {
        return function handleScale(viewspace, newScale) {
          listener(viewspace, newScale);
        };
      },
    }),

    PORT: 9000,

    STAMPER: new WamsShared.IDStamper(),

    VALID_EVENTS: Object.freeze([
      'click',
      'drag',
      'scale',
      'layout',
    ]),

    generateRequestHandler() {
      const app = express();

      // Establish routes.
      app.get('/', (req, res) => {
        res.sendFile(path.resolve('../src/view.html'));
      });
      app.get('/shared.js', (req, res) => {
        res.sendFile(path.resolve('../src/shared.js'));
      });
      app.get('/client.js', (req, res) => {
        res.sendFile(path.resolve('../src/client.js'));
      });

      /* 
       * XXX: express.static() generates a middleware function for 
       *    serving static assets from the directory specified.
       *    - The order in which these functions are registered with
       *      app.use() is important! The callbacks will be triggered
       *      in this order!
       *    - When app.use() is called without a 'path' argument, as it 
       *      is here, it uses the default '/' argument, with the 
       *      result that these callbacks will be executed for 
       *      _every_ request to the app!
       *      + Should therefore consider specifying the path!!
       *    - Should also consider specifying options. Possibly useful:
       *      + immutable
       *      + maxAge
       */
      app.use(express.static(path.resolve('./Images')));
      app.use(express.static(path.resolve('../libs')));

      return app;
    },

    getLocalIP() {
      const os = require('os');
      let ipaddr = null;
      Object.values(os.networkInterfaces()).some( f => {
        return f.some( a => {
          if (a.family === 'IPv4' && a.internal === false) {
            ipaddr = a.address;
            return true;
          }
          return false;
        });
      });
      return ipaddr;
    },

    isValidEvent(event) {
      return locals.VALID_EVENTS.some(v => v === event);
    },

    removeByItemID(array, item) {
      const idx = array.findIndex( o => o.id === item.id );
      if (idx >= 0) {
        array.splice(idx, 1);
        return true;
      }
      return false;
    },

  });

  class WorkSpace {
    constructor(port = locals.PORT, settings) {
      this.settings = WamsShared.initialize(locals.DEFAULTS, settings);
      locals.STAMPER.stamp(this, port);

      // Things to track.
      this.connections = [];
      this.subWS = [];
      this.users = [];
      this.wsObjects = [];

      // Will be used for establishing a server on which to listen.
      this.http = null;
      this.io = null;
      this.port = this.id;
      WamsShared.makeOwnPropertyImmutable(this, 'port');

      // Attach NOPs for the event listeners, so they are callable.
      this.handlers = {};
      locals.VALID_EVENTS.forEach( ev => {
        this.handlers[ev] = WamsShared.NOP;
      });
    }

    get width() { return this.settings.bounds.x; }
    get height() { return this.settings.bounds.y; }

    set width(width) { this.settings.bounds.x = width; }
    set height(height) { this.settings.bounds.y = height; }

    addSubWS(subWS) {
      this.subWS.push(subWS);
      //TODO: add check to make sure subWS is in bounds of the main workspace
      //TODO: probably send a workspace update message
    }

    addWSObject(obj) {
      globals.OBJ_ID_STAMPER.stamp(obj);
      this.wsObjects.push(obj);
    }

    findObjectByCoordinates(x,y) {
      return this.wsObjects.find( o => o.containsPoint(x,y) );
    }

    getCenter() {
      return {
        x: this.settings.bounds.x / 2,
        y: this.settings.bounds.y / 2
      };
    }

    hasUser(user) {
      return this.users.some( u => u.id === user.id );
    }

    isFull() {
      return this.users.length >= this.settings.clientLimit;  
    }

    listen() {
      this.http = http.createServer(generateRequestHandler());
      this.http.listen(this.id, getLocalIP(), () => {
        console.log('Listening on', this.http.address());
      });
      this.io = io.listen(this.http);
      this.io.on('connection', (socket) => {
        this.connections.push(new Connection(socket, this));
      });
    }

    on(event, listener = WamsShared.NOP) {
      const key = event.toLowerCase();
      if (locals.isValidEvent(key)) {
        this.handlers[key] = locals.HANDLER_FACTORY[key](listener).bind(this);
      }
    }

    removeUser(view) {
      return locals.removeByItemID(this.users, view);
    }

    removeWSObject(obj) {
      return locals.removeByItemID(this.wsObjects, obj);
    }

    reportUsers() {
      return this.users.map( v => v.report() );
    }

    reportWSObjects() {
      return this.wsObjects.map( o => o.report() );
    }

    spawnUser() {
      if (!this.isFull()) {
        const u = new ServerViewSpace(this.settings.bounds);
        this.users.push(u);
        return u;
      }
      return false;
    }

  }

  return WorkSpace;
})();

class Connection {
  constructor(socket, workspace) {
    /*
     * XXX: Make the desired bounds an argument passed into the
     *    constructor?
     */
    this.initializedLayout = false;
    this.socket = socket;
    this.workspace = workspace;
    this.viewSpace = this.workspace.spawnUser();
    if (!this.viewSpace) {
      this.socket.disconnect(true);
      return undefined;
    }

    console.log(
      `User ${this.viewSpace.id} ` +
      `connected to workspace ${this.workspace.id}`
    );

    /*
     * XXX: This is a nifty way of making it easy to add and remove
     *    event strings to this list, but is it really that good of an
     *    idea? Is it readable?
     */
    [   
      {msg: 'disconnect',     handler: 'disconnect'},
      {msg: 'handleClick',    handler: 'click'},
      {msg: 'handleDrag',     handler: 'drag'},
      {msg: 'handleScale',    handler: 'scale'},
      {msg: 'reportView',     handler: 'update'},
      {msg: globals.MSG_LAYOUT,   handler: 'layout'},
    ].forEach( e => this.socket.on(e.msg, this[e.handler].bind(this)) );

    this.socket.emit(globals.EVENT_INIT, {
      views: this.workspace.reportViews(),
      wsObjects: this.workspace.reportWSObjects(),
      settings: this.workspace.settings,
      id: this.viewSpace.id,
    });
  }

  /*
   * XXX: This might be a place where socket.io 'rooms' could
   *    come in handy. Look into it...
   */
  broadcast(event, data) {
    this.socket.emit(event, data);
    this.socket.broadcast.emit(event, data);
  }

  broadcastUserReport() {
    this.broadcast(
      globals.EVENT_UD_USER,
      this.viewSpace.report()
    );
  }

  broadcastObjectReport() {
    this.broadcast(
      globals.EVENT_UD_OBJS,
      this.workspace.reportWSObjects()
    );
  }

  /*
   * XXX: Shouldn't we disconnect the socket???
   */
  disconnect() {
    if (this.workspace.removeView(this.viewSpace.id)) {
      console.log(
        `user ${this.viewSpace.id} ` +
        `disconnected from workspace ${this.workspace.id}`
      );
      this.broadcast(globals.EVENT_RM_USER, this.viewSpace.id);
      this.socket.disconnect(true);
    } else {
      throw 'Failed to disconnect.'
    }
  }

  /*
   * XXX: handleClick and handleDrag can probably be collapsed down to more
   *    or less the same function. The only difference is the name of
   *    the handler and the arguments, but I think we can just pass the
   *    arguments through with some JavaScript operator or function...
   *
   *    That said, we should probably figure out why handleDrag is checking
   *    the viewSpace id but handleClick is not...
   */
  click(x, y) {
    this.workspace.click(this.viewSpace, x, y);
    this.broadcastUserReport();
    this.broadcastObjectReport();
  }

  drag(viewspace, x, y, dx, dy) {
    if (viewspace.id !== this.viewSpace.id) return;
    this.workspace.drag(viewspace, x, y, dx, dy);
    this.broadcastObjectReport()
    this.broadcastUserReport();
  }

  scale(vs, newScale) {
    // Failsafe checks.
    if (vs.id !== this.viewSpace.id) return;
    this.workspace.scale(vs, newScale);
    this.broadcastUserReport()
  }

  layout() {
    if (!this.workspace.layout(this.viewSpace)) {
      this.socket.send(globals.EVENT_DC_USER);
    }
  }

  /*
   * XXX: What exactly does reportView do? The name is ambiguous, so once I
   *    figure this out I will definitely change it.
   */
  update(vsInfo) {
    if (this.viewSpace.id === vsInfo.id) {
      this.viewSpace.assign(vsInfo);
      this.broadcastUserReport()
    }
  }
}

const ServerWSObject = (function defineServerWSObject() {
  const locals = Object.freeze({
    DEFAULTS: Object.freeze({
      x: 0,
      y: 0,
      width: 128,
      height: 128,
      type: 'view/background',
      imgsrc: '',
      drawCustom: '',
      drawStart: '',
    }),
  });

  class ServerWSObject extends WamsShared.WSObject {
    /*
     * XXX: What is the object supposed to be if the draw strings are not 
     *      defined?
     */
    constructor(values = {}) {
      super(WamsShared.initialize(locals.DEFAULTS, values));
    }

    containsPoint(x,y) {
      return  (this.x <= x) && 
        (this.x + this.width >= x) && 
        (this.y <= y) && 
        (this.y + this.height >= y);
    }

    /*
     * Items are allowed to be moved off screen, so limitations on where
     * items can be moved to.
     */
    moveToXY(x = this.x, y = this.y) {
      this.assign({x,y});
    }

    move(dx = 0, dy = 0) {
      this.moveToXY(this.x + dx, this.y + dy);
    }
  }

  return ServerWSObject;
})();

const ServerViewSpace = (function defineServerViewSpace() {
  const locals = Object.freeze({
    DEFAULTS: {
      x: 0,
      y: 0,
      width: 1600,
      height: 900,
      type: 'view/background',
      effectiveWidth: 1600,
      effectiveHeight: 900,
      scale: 1,
      rotation: 0,
    },

    MIN_DIMENSION: 100,

    STAMPER: new WamsShared.IDStamper(),

    resolveBounds(bounds = {}) {
      function safeNumber(x) {
        return Number(x) || 0; // Prevents NaN from falling through.
      }
      const x = safeNumber(bounds.x);
      const y = safeNumber(bounds.y);
      if (x < 100 || y < 100) throw 'Invalid bounds received';
      return {x,y};
    }
  });

  class ServerViewSpace extends WamsShared.ViewSpace {
    constructor(bounds, values) {
      super(WamsShared.initialize(locals.DEFAULTS, values));
      this.bounds = locals.resolveBounds(bounds);
      this.effectiveWidth = this.width / this.scale;
      this.effectiveHeight = this.height / this.scale;
      locals.STAMPER.stamp(this);
    }

    get bottom()  { return this.y + this.effectiveHeight; }
    get left()    { return this.x; }
    get right()   { return this.x + this.effectiveWidth; }
    get top()     { return this.y; }

    /*
     * The center() getter returns an object that exposes x and y getters which
     * will always return the _current_ (at the moment the getter is called)
     * center of the viewspace along that dimension.
     */
    get center()  {
      return ((view) => {
        return Object.freeze({
          get x() { return view.x + (view.effectiveWidth  / 2); },
          get y() { return view.y + (view.effectiveHeight / 2); },
        });
      })(this);
    }

    canBeScaledTo(width, height) {
      return  (width  > 0) &&
              (height > 0) &&
              (this.x + width  <= this.bounds.x) &&
              (this.y + height <= this.bounds.y);
    }

    canMoveToX(value) {
      return (value >= 0) && (value + this.effectiveWidth <= this.bounds.x);
    }

    canMoveToY(value) {
      return (value >= 0) && (value + this.effectiveHeight <= this.bounds.y);
    }

    /*
     * ViewSpaces are constrained to stay within the boundaries of the
     * workspace, to protect the render.
     */
    moveToXY(newX, newY) {
      const values = {
        x: this.x, 
        y: this.y
      };
      if (this.canMoveToX(newX)) values.x = newX;
      if (this.canMoveToY(newY)) values.y = newY;
      this.assign(values);
    }

    move(dx, dy) {
      this.moveToXY(this.x + dx, this.y + dy);
    }

    /*
     * XXX: Divide by? Maybe I need to refresh my understanding of the word 
     *    'scale', because my intuition is to say that this the reverse of what 
     *    we actually want. I could very easily be wrong about this though. 
     *    I'll look it up.
     *
     *    Also at this point I really think we should have an 'isInRange' 
     *    function for checking bounds.
     */
    rescale(newScale) {
      const newWidth = this.width / newScale;
      const newHeight = this.height / newScale;
      if (this.canBeScaledTo(newWidth, newHeight)) {
        this.assign({
          scale: newScale,
          effectiveWidth: newWidth,
          effectiveHeight: newHeight,
        });
      } 
    }
  }

  return ServerViewSpace;
})();

exports.WorkSpace = WorkSpace;
exports.WSObject = ServerWSObject;

/*
 * For testing:
 */
exports.Connection = Connection;
exports.ServerWSObject = ServerWSObject;
exports.ServerViewSpace = ServerViewSpace;

