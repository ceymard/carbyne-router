
import {o, merge, Eventable, Observable, Atom} from 'carbyne';
import {StateDefinition, State, StateParams, ActiveStates} from './state';

export class RedirectError extends Error {
  params: StateParams
  name: string
}

/**
 * A router that can link to window.location.
 */
export class Router extends Eventable<Router> {

  public o_state: Observable<State>
  // public o_active_states: Observable<{[name: string]: State}>
  public o_active_states: Observable<ActiveStates>

  public current_state_def: StateDefinition

  private _params: StateParams = {}
  private _activating: boolean
  private _state_defs: {[name: string]: StateDefinition}
  private _linked: boolean
  private _default: {name: string, params: {}}
  private _triggered_change = false

  constructor() {
    super()

    this._state_defs = {}

    this.o_active_states = o({states: {}, params: {}, current_state: null})
    this.o_state = o({})
    this.current_state_def = null

    this._params = {}

    this._activating = false

    // Query is an observable, since we don't use it in routing.

    this._linked = false // true if linked to location.
  }

  default(name: string, params: any) {
    this._default = {name, params}
    return this
  }

  redirect(name: string, params: StateParams = {}) {
    var r = new RedirectError(`redirecting to ${name}`)
    r.name = name
    r.params = params
    throw r
  }

  /**
   * Create a new state for our router.
   * @param {String} name The name of the state.
   * @param {object} desc The full description of the state.
   */
  state(name: string, url: string, fn: typeof State) {

    if (this._state_defs[name]) throw new Error(`state '${name}' is already defined`)

    let parent_idx = name.lastIndexOf('.')
    let parent: StateDefinition = null
    if (parent_idx > -1) {
      let parent_name = name.substring(0, parent_idx)
      if (!this._state_defs[parent_name]) throw new Error(`parent state '${parent_name}' does not exist`)
      parent = this._state_defs[parent_name]
    }

    let state = new StateDefinition(name, url, fn, parent, this)
    this._state_defs[name] = state;

    return this;
  }

  virtualState(name: string, url: string, fn: typeof State) {
    this.state(name, url, fn)
    this._state_defs[name].virtual = true
    return this
  }

  /**
   * Set the URL of the router by finding its matching state
   * and activating it.
   * If none match, go the the 'default' state if it exists.
   * Otherwise, triggers an error.
   *
   * @param {string} url: The url we want to go to.
   */
  setUrl(url: string) {

    for (let name in this._state_defs) {
      let st = this._state_defs[name]
      let params = st.match(url)
      if (params) {
        return this._activate(st, params)
      }
    }

    if (this._default) {
      // If we can't find a state matching the current URL, send
      // to the default state.
      return this.go(this._default.name, this._default.params)
    }

    throw new Error('no matching state found')
  }

  /**
   * [go description]
   * @param  {[type]} state_name [description]
   * @param  {[type]} params     [description]
   * @return {Promise} A promise that tells when the state has been fully activated.
   */
  go(state_name: string, params: StateParams = {}): Promise<State> {

    if (this._activating)
      this.redirect(state_name, params);

    const state = this._state_defs[state_name];
    if (!state) throw new Error(`no such state ${state_name}`)

    const _params = merge({}, params)

    for (let x of state.param_names)
      if (!(x in params)) _params[x] = this._params[x]

    if (!state) throw new Error('no such state');
    return this._activate(this._state_defs[state_name], _params).then((state) => {
      if (this._linked) {
        var url = this.current_state_def.getUrl(_params);
        this._triggered_change = true;
        window.location.hash = '#' + url;
      }
      return state
    });

  }

  /**
   * Perform the activation of the new state.
   * If the activation raised an error, triggers the 'reject' event.
   */
  _activate(def: StateDefinition, params: StateParams): Promise<State> {

    const previous_states = this.o_active_states.get()

    this.trigger('activate:before', def, params)
    this._activating = true

    // Try activating the new state.
    return def.activate(params, previous_states).then((result: ActiveStates) => {

      // The last state to be computed is now our parent.
      // XXX could be useful
      this.o_active_states.set(result)
      this.o_state.set(result.current_state)

      this.current_state_def = def // result.state._definition
      this._params = result.params

      // console.log(previous_states)
      for (let name in previous_states.states)
        if (!result.states[name]) previous_states.states[name].destroy()

      // XXX destroy the now inactive states.

      // Activate the new views.
      this.trigger('activate', def, params)
      this._activating = false

      return result.current_state

    }).catch((failure: Error|RedirectError) => {
      console.error(failure)
      this._activating = false

      if (failure instanceof RedirectError) {
        return this.go(failure.name, failure.params)
      }
      // A state has rejected the activation.
      this.trigger('reject', failure, def, params)
      return null
    })

  }

  /**
   * [linkWithLocation description]
   */
  linkWithLocation() {
    this._linked = true

    let change = () => {
      let hash = window.location.hash
      if (!this._triggered_change) {
        this.setUrl(hash.split('?')[0].slice(1))
      }
      this._triggered_change = false
    }

    window.addEventListener('hashchange', change)
    change()
  }

  /**
   * A decorator that sets up the href
   */
  href(name: string, params?: StateParams): (a: Atom) => Atom {
    return (atom: Atom) => {
      let state = this._state_defs[name]

      atom.on('create', (ev) => {

        var evaluate = (active: boolean) => {

          if (active) atom.element.classList.add('state-active')
          else atom.element.classList.remove('state-active')

          if (this.o_state.get().name === name)
            atom.element.classList.add('state-current')
          else
            atom.element.classList.remove('state-current')
          return active
        }

        atom.observe(params, (p) => {
          (atom.element as any).href = state ? '#' + state.getUrl(params) : ''
        })

        atom.observe(this.o_active_states, (active_states) => {
          if (!active_states.states || !active_states.states[name]) return evaluate(false)
          if (!params) return evaluate(true)

          const pars = active_states.params

          for (let x in pars) {
            if (pars[x] !== params[x].toString()) return evaluate(false)
          }
          return evaluate(true)
        })

      })

      return atom
    }
  }

}
