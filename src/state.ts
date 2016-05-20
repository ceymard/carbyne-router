
import {o, merge, Eventable, Controller, Observable, Observer} from 'carbyne';
import {Router} from './router'


/**
 *
 */
export class State extends Eventable {

	public name: string
	private _definition: StateDefinition

	private _controllers: Array<Controller>
	private _router: Router
	private __proto__: State

	constructor(name: string, router: Router) {
		super()
		this.name = name
		this._controllers = []
		this._router = router
	}

	__init__(...args: any[]) : Promise<any> {
		// Initialise the state.
		return Promise.resolve(true)
	}

	addController(ctrl: Controller) {
		this._controllers.push(ctrl)
		ctrl.setAtom(this) // XXX?
	}

  getController(cls) {

    let res = null
    let state = this as State

    while (state) {
      for (let ctrl of state._controllers) {
        if (ctrl instanceof cls) {
          return ctrl
        }
      }

      state = state.__proto__
    }

    return null

  }

	observe<T>(obs: Observable<T>, cbk: Observer<T>) { this.on('destroy', obs.addObserver(o(cbk))) }

	/**
	 * Go to the given state of the current router.
	 * Also, pre-fills the asked params.
	 */
	go(state_name: string, params: Object) { this._router.go(state_name, params) }

	destroy() {
		this.trigger('destroy')
		this._router = null
		this._controllers = null
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

	constructor(name: string, url: string, kls: typeof State, parent, router) {
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

	getUrl(params = {}) {
		if (this.virtual) throw new Error('Virtual states don\'t have urls.')
		let url = this._full_url
		for (let p of this.param_names) {
			url = url.replace(`:${p}`, params[p])
		}
		return url
	}

	match(url) {
		if (this.virtual) return null

		let matches = this.regexp.exec(url)

		// this state does not match the url.
		if (!matches) return null

		// build the params.
		let params = {}
		let pars = this.param_names
		let l = this.param_names.length
		for (let i = 0; i < l; i++) {
			params[pars[i]] = matches[i + 1]
		}
		return params
	}

	isParent(state) {
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
	_sameParams(prev_params, new_params) {
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
	activate(params, previous) {

		// If we have a parent, we start by trying to activate
		return (this.parent ?
			this.parent.activate(params, previous)
		: 	Promise.resolve({state: new State('__root__', this._router), all: {$$params: params}})
		).then(act => {

			// If the state is already active, then there
			// is no need to try to reactivate it, unless of course
			// params have changed.
			if (previous[this.name] && this._sameParams(previous.$$params, params)) {
				act.state = act.all[this.name] = previous[this.name]
				return act
			}

			// Build the parameter list
			const prms = []
			for (var pname of this.param_names)
				prms.push(params[pname])

			const kls = this._kls
			const own_init = kls.prototype.hasOwnProperty('__init__') ? kls.prototype.__init__ : null
			const state = new kls(this.name, this._router)

			// Récupération des valeurs par copie brutale.
			for (let name in act.state) {
				if (act.state.hasOwnProperty(name)) {
					state[name] = act.state[name]
				}
			}

			// StateInstance.prototype = act.state
			// const state = new StateInstance

			return Promise.resolve(own_init ? own_init.apply(state, prms) : null).then(nothing => {
				act.all[this.name] = state
				act.state = state
				return act
			})
		})

	}


}
