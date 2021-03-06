/*
 * WAMS code to be executed in the client browser.
 *
 * Author: Michael van der Kamp
 */

'use strict';

/**
 * The MessageHandler logs listeners that are attached by the user and receives
 * messages from clients, which it then uses to call the appropriate listener.
 *
 * @memberof module:server
 *
 * @param {module:server.WorkSpace} workspace - the model used when responding
 * to messages.
 */
class MessageHandler {
  constructor(workspace) {
    /**
     * The model to access when responding to messages.
     *
     * @type {module:server.WorkSpace}
     */
    this.workspace = workspace;

    /**
     * Layout handler, for when clients connect to the application.
     *
     * @type {function}
     */
    this.onlayout = null;
  }

  /**
   * Handle a message for the given gesture.
   *
   * @param {string} gesture
   */
  handle(gesture, view) {
    function do_gesture({ data }) {
      const target = view.lockedItem;
      if (target != null) {
        const { centroid } = data;
        const { x, y } = view.transformPoint(centroid.x, centroid.y);
        const event = { view, target, x, y };
        this[gesture](event, data);
      }
    }
    return do_gesture.bind(this);
  }

  /**
   * Apply a click event
   *
   * @param {object} event
   */
  click(event) {
    const { target, x, y } = event;

    if (typeof target.containsPoint === 'function' &&
      target.containsPoint(x, y)) {
      if (target.onclick) target.onclick(event);
    } else {
      const target = this.workspace.findFreeItemByCoordinates(x, y) ||
        event.view;
      if (target.onclick) target.onclick({ ...event, target });
    }
  }

  /**
   * Performs locking and unlocking based on the phase and number of active
   * points.
   *
   * @param {Object} data
   * @param {module:shared.Point2D[]} data.active - Currently active contact
   * points.
   * @param {module:shared.Point2D} data.centroid - Centroid of active contact
   * points.
   * @param {string} data.phase - 'start', 'move', or 'end', the gesture phase.
   * @param {module:server.ServerView} view - Origin of track request.
   */
  track({ active, centroid, phase }, view) {
    if (phase === 'start' && view.lockedItem == null) {
      this.workspace.obtainLock(centroid.x, centroid.y, view);
    } else if (phase === 'end' && active.length === 0) {
      view.releaseLockedItem();
    }
  }

  /**
   * Apply a transformation event, splitting it into rotate, scale, and
   * move.
   *
   * @param {object} event
   * @param {object} data
   */
  transform(event, data) {
    const { delta } = data;

    if (delta.hasOwnProperty('scale')) {
      this.scale(event, delta);
    }

    if (delta.hasOwnProperty('rotation')) {
      this.rotate(event, delta);
    }

    if (delta.hasOwnProperty('translation')) {
      this.drag(event, delta);
    }
  }

  /**
   * Apply a scale event
   *
   * @param {object} event
   * @param {object} scale
   */
  scale(event, { scale }) {
    if (event.target.onscale) event.target.onscale({ ...event, scale });
  }

  /**
   * Apply a rotate event
   *
   * @param {object} event
   * @param {object} rotation
   */
  rotate(event, { rotation }) {
    if (event.target.onrotate) event.target.onrotate({ ...event, rotation });
  }

  /**
   * Apply a swipe event
   *
   * @param {object} event
   * @param {module:shared.Point2D} change
   */
  drag(event, { translation }) {
    const d = event.view.transformPointChange(translation.x, translation.y);
    if (event.target.ondrag) event.target.ondrag({
      ...event,
      dx: d.x,
      dy: d.y,
    });
  }

  /**
   * Apply a swipe event
   *
   * @param {object} event
   * @param {object} data
   */
  swipe(event, data) {
    const { target } = event;
    const { velocity, direction } = data;
    if (target.onswipe) target.onswipe({ ...event, velocity, direction });
  }
}

module.exports = MessageHandler;

