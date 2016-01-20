
import {o, merge, Eventable} from 'carbyne';
import {View} from './view';
import {StateDefinition, State} from './state';

/**
 * A router that can link to window.location.
 */
class Router extends Eventable {

  constructor() {
    super();

    this._state_defs = {};

    this.o_active_states = o({});
    this.o_state = o({})
    this.current_state_def = null

    this._params = {}

    this._activating = false;

    // Query is an observable, since we don't use it in routing.

    this._linked = false; // true if linked to location.
  }

  default(name, args) {
    this.default = {name, args};
    return this;
  }

  redirect(name, args = {}) {
    throw {redirect: true, name, args};
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

    if (this._activating)
      this.redirect(state_name, params);

    const state = this._state_defs[state_name];
    if (!state) throw new Error(`no such state ${state_name}`)

    const _params = merge({}, params)
    let x = null

    for (x of state.param_names)
      if (!(x in params)) _params[x] = this._params[x]

    if (!state) throw new Error('no such state');
    return this._activate(this._state_defs[state_name], _params).then(activated => {
      if (this._linked) {
        var url = this.current_state_def.getUrl(_params);
        this._triggered_change = true;
        window.location.hash = '#' + url;
      }
    });

  }

  /**
   * Perform the activation of the new state.
   * If the activation raised an error, triggers the 'reject' event.
   */
  _activate(state : State, params : Object = {}) : Promise {

    const previous_states = this.o_active_states.get()
    this.trigger('activate:before', state, params)
    this._activating = true;

    // Try activating the new state.
    return state.activate(params, previous_states).then(result => {

      // The last state to be computed is now our parent.
      // XXX could be useful
      this.o_active_states.set(result.all)
      this.o_state.set(result.state)
      this.current_state_def = result.state._definition
      this._params = params

      let name = null;

      console.log(previous_states)
      for (name in previous_states)
        if (!result.all[name]) previous_states[name].$destroy();

      // XXX destroy the now inactive states.

      // Activate the new views.
      this.trigger('activate', state, params);
      this._activating = false;

    }).catch(failure => {
      console.error(failure);
      this._activating = false;

      if (failure.redirect) {
        return this.go(failure.name, failure.args);
      }
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

          // FIXME this is bugged
          if (this.o_state.get()._name === this._state_defs[name])
            atom.element.classList.add('state-current');
          else
            atom.element.classList.remove('state-current');
          return active;
        }

        atom.observe(params, (p) => {
          atom.element.href = '#' + state.getUrl(params);
        });

        atom.observe(this.o_active_states, (states) => {
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


export {Router, View, State};
