
import {o, merge, Eventable, Observable, Observer} from 'carbyne';
import {Router} from './router'

export interface StateParams {
  [name: string]: any
}

export interface ActiveStates {

	params: StateParams
	current_state: State

	states: {
		[state_name: string]: State
	}

}

/**
 *
 */
export class State extends Eventable<State> {

	public name: string
	public parent: State
	private _definition: StateDefinition

	private _router: Router
	private __proto__: State

	constructor(name: string, router: Router) {
		super()
		this.name = name
		this._router = router
	}

	__init__(...args: any[]) : Promise<any>|void {
		// Initialise the state.
		return Promise.resolve(true)
	}

	observe<T>(obs: Observable<T>, cbk: Observer<T>) { this.on('destroy', obs.addObserver(o(cbk))) }

	/**
	 * Go to the given state of the current router.
	 * Also, pre-fills the asked params.
	 */
	go(state_name: string, params: StateParams) { this._router.go(state_name, params) }

	destroy() {
		this.trigger('destroy')
		this._router = null
	}

}

/**
 * A single state, able to tell if it matches an url.
 */
export class StateDefinition {

	public is_active: Observable<boolean>
	public name: string
	public url_part: string
	public param_names: Array<string>
	public regexp: RegExp
	public virtual: boolean

	public parent: StateDefinition
	public router: Router

	private _kls: typeof State
	private _full_url: string
	private _router: Router

	constructor(name: string, url: string, kls: typeof State, parent: StateDefinition, router: Router) {
		this.name = name
		this.url_part = url
		this._full_url = ''
		this._kls = kls
		this.parent = parent
		this.param_names = []
		this.regexp = null
		this._router = router

		this.virtual = false

		this.build()
	}

	deactivate() {
		this.is_active.set(false)
	}

	build() {
		let full_url = this.url_part
		let parent = this.parent

		while (parent) {
			full_url = `${parent.url_part}${full_url}`
			parent = parent.parent
		}

		this.regexp = new RegExp('^' + full_url.replace(/:[a-zA-Z_$]\w*/g, name => {
			this.param_names.push(name.slice(1)) // remove the leading :
			return '(\\d+)'
		}) + '$')

		this._full_url = full_url
	}

	getUrl(params: StateParams = {}) {
		if (this.virtual) throw new Error('Virtual states don\'t have urls.')
		let url = this._full_url
		for (let p of this.param_names) {
			url = url.replace(`:${p}`, params[p])
		}
		return url
	}

	match(url: string) {
		if (this.virtual) return null

		let matches = this.regexp.exec(url)

		// this state does not match the url.
		if (!matches) return null

		// build the params.
		let params: StateParams = {}
		let pars = this.param_names
		let l = this.param_names.length
		for (let i = 0; i < l; i++) {
			params[pars[i]] = matches[i + 1]
		}
		return params
	}

	isParent(state: StateDefinition) {
		while (state.parent) {
			if (state === this) return true
			state = state.parent
		}
		return false
	}

	/**
	 * Compare the previous parameters and the new ones, relative
	 * to the param_names of this state (other names won't be checked
	 * for changes).
	 *
	 * Note: the difference is checked using strict equality.
	 *
	 * @param  {Object} prev_params ...
	 * @param  {Object} new_params  ...
	 * @return {boolean}
	 */
	_sameParams(prev_params: StateParams, new_params: StateParams) {
		for (var name of this.param_names) {
			if (prev_params[name] !== new_params[name])
				return false;
		}
		return true;
	}

	/**
	 * NOTE This function should return a promise instead of doing it
	 * 			all inline.
	 * @param  {Object} state The state object to activate.
	 */
	activate(params: StateParams, previous: ActiveStates): Promise<ActiveStates> {

		// If we have a parent, we start by trying to activate
		return (this.parent ?
			this.parent.activate(params, previous)
		: Promise.resolve({current_state: null, params: params, states: {}})
		).then((act: ActiveStates) => {

			// If the state is already active, then there
			// is no need to try to reactivate it, unless of course
			// params have changed.
			if (previous.states[this.name] && this._sameParams(previous.params, params)) {
				act.current_state = act.states[this.name] = previous.states[this.name]
				return act
			}

			// Build the parameter list
			const prms = this.param_names.map(name => params[name])

			const kls = this._kls
			const own_init = kls.prototype.hasOwnProperty('__init__') ? kls.prototype.__init__ : null
			const state = new kls(this.name, this._router)

			// copy values that were initialized by __init__ from the parent state.
			if (act.current_state) {
				merge(state, act.current_state)
			}

			return Promise.resolve(own_init ? own_init.apply(state, prms) : null).then(() => {
				act.states[this.name] = state
				act.current_state = state
				return act
			})
		})

	}


}
