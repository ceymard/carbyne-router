
import {o, merge, Eventable} from 'carbyne';
import {View} from './view';
import {StateDefinition} from './state';

/**
 * A router that can link to window.location.
 */
class Router extends Eventable {

  constructor() {
    super();

    this._state_defs = {};

    this.active_states = o({});
    this.computed_views = o({});
    // this.query = o(null);

    this.current_state = null;

    // Query is an observable, since we don't use it in routing.

    this._linked = false; // true if linked to location.
  }

  default(name, args) {
    this.default = {name, args};
    return this;
  }

  /**
   * Create a new state for our router.
   * @param {String} name The name of the state.
   * @param {object} desc The full description of the state.
   */
  state(name, url, fn) {

    if (this._state_defs[name]) throw new Error(`state '${name}' is already defined`);

    let parent_idx = name.lastIndexOf('.');
    let parent = null;
    if (parent_idx > -1) {
      parent = name.substring(0, parent_idx);
      if (!this._state_defs[parent]) throw new Error(`parent state '${parent}' does not exist`);
      parent = this._state_defs[parent];
    }

    let state = new StateDefinition(name, url, fn, parent, this);
    this._state_defs[name] = state;

    return this;
  }

  virtualState(name, url, fn) {
    this.state(name, url, fn);
    this._state_defs[name].virtual = true;
    return this;
  }

  /**
   * Set the URL of the router by finding its matching state
   * and activating it.
   * If none match, go the the 'default' state if it exists.
   * Otherwise, triggers an error.
   * 
   * @param {string} url: The url we want to go to.
   */
  setUrl(url : string) : Promise {
    for (let name in this._state_defs) {
      let st = this._state_defs[name];
      let params = st.match(url);
      if (params) {
        return this._activate(st, params);
      }
    }

    if (this.default) {
      // If we can't find a state matching the current URL, send
      // to the default state.
      return this.go(this.default.name, this.default.params);      
    }

    throw new Error('no matching state found');
  }

  /**
   * [go description]
   * @param  {[type]} state_name [description]
   * @param  {[type]} params     [description]
   * @return {Promise} A promise that tells when the state has been fully activated.
   */
  go(state_name : string, params : Object = {}) : Promise {

    const state = this._state_defs[state_name];
    if (!state) throw new Error('no such state');
    if (this._linked) {
      var url = state.getUrl(params);
      this._triggered_change = true;
      window.location.hash = '#' + url;
    }
    return this._activate(this._state_defs[state_name], params);

  }

  /**
   * Perform the activation of the new state.
   * If the activation raised an error, triggers the 'reject' event.
   */
  _activate(state : State, params : Object = {}) : Promise {

    this.trigger('activate:before', state, params);

    // Try activating the new state.
    return state.activate(params, this.active_states.get()).then(result => {

      // The last state to be computed is now our parent.
      this.computed_views.set(result.parent.views);
      // This is for rememberance of who was active
      this.active_states.set(result.all);
      // XXX could be useful
      this.current_state = state;

      // Activate the new views.
      this.trigger('activate', state, params);

    }).catch(failure => {
      console.error(failure);

      // A state has rejected the activation.
      this.trigger('reject', failure, state, params);

    });

  }

  /**
   * [linkWithLocation description]
   */
  linkWithLocation() {
    this._linked = true;

    let change = (event) => {
      let hash = window.location.hash;
      if (!this._triggered_change) {
        this.setUrl(hash.split('?')[0].slice(1));
      }
      this._triggered_change = false;
    }

    window.addEventListener('hashchange', change);
    change();
  }

  /**
   * A decorator that sets up the href
   */
  href(name : string, params : Object) {
    return (atom : Atom) => {
      let state = this._state_defs[name];
      // atom.attrs.href = '#' + state.getUrl(params);

      atom.on('create', (ev) => {

        var evaluate = active => {

          if (active) atom.element.classList.add('state-active');
          else atom.element.classList.remove('state-active');

          if (this.current_state === this._state_defs[name])
            atom.element.classList.add('state-current');
          else
            atom.element.classList.remove('state-current');
          return active;
        }

        atom.observe(params, (p) => {
          atom.element.href = '#' + state.getUrl(params);
        });

        atom.observe(this.active_states, (states) => {
          if (!states[name]) return evaluate(false);
          if (!params) return evaluate(true);

          const pars = states.$$params;

          for (let x in pars) {
            if (pars[x] !== params[x].toString()) return evaluate(false);
          }
          return evaluate(true);
        });

      });
    }
  }

}


export {Router, View};
