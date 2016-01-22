
import {o, merge, Eventable} from 'carbyne';

type Views = {[key : string] : () => Atom};

export class RootState extends Eventable {

	_router : Router;

	constructor(router) {
		super();
		this._controllers = [];
		this._router = router;
	}

	addController(ctrl) {
		this._controllers.push(ctrl);
		ctrl.setAtom(this); // XXX?
	}

  getController(cls, opts = {}) {

    let res = null;
    let state = this;

    let all = opts.all;

    while (state) {
      for (let ctrl of state._controllers) {
        if (ctrl instanceof cls) {
          return ctrl;
        }
      }

      state = state.__proto__;
    }

    return null;

  }

	$observe(obs, cbk) {
		this.on('destroy', o.observe(obs, cbk));
	}

	/**
	 * Go to the given state of the current router.
	 * Also, pre-fills the asked params.
	 */
	$go(state_name, params) {
		this._router.go(state_name, params);
	}

	$destroy() {
		this.trigger('destroy');
		this._router = null;
		this._controllers = null;
	}

}

/**
 * A single state, able to tell if it matches an url.
 */
export class StateDefinition {

	constructor(name, url, fn, parent, router) {
		this.name = name;
		this.url_part = url;
		this._full_url = '';
		this._fn = fn;
		this.parent = parent;
		this.param_names = [];
		this.regexp = null;
		this._router = router;

		this.view_functions = null;
		this.active_data = null;
		this.virtual = false;

		this.build();
	}

	deactivate() {
		this.is_active.set(false);
		this.view_functions = null;
		this.active_data = null;
	}

	build() {
		let full_url = this.url_part;
		let parent = this.parent;

		while (parent) {
			full_url = `${parent.url_part}${full_url}`;
			parent = parent.parent;
		}

		this.regexp = new RegExp('^' + full_url.replace(/:[a-zA-Z_$]\w*/g, name => {
			this.param_names.push(name.slice(1)); // remove the leading :
			return '(\\d+)';
		}) + '$');

		this._full_url = full_url;
	}

	getUrl(params = {}) {
		if (this.virtual) throw new Error('Virtual states don\'t have urls.');
		let url = this._full_url;
		for (let p of this.param_names) {
			url = url.replace(`:${p}`, params[p]);
		}
		return url;
	}

	match(url) {
		if (this.virtual) return null;

		let matches = this.regexp.exec(url);

		// this state does not match the url.
		if (!matches) return null;

		// build the params.
		let params = {};
		let pars = this.param_names;
		let l = this.param_names.length;
		for (let i = 0; i < l; i++) {
			params[pars[i]] = matches[i + 1];
		}
		return params;
	}

	isParent(state) {
		while (state.parent) {
			if (state === this) return true;
			state = state.parent;
		}
		return false;
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
	_sameParams(prev_params : Object, new_params : Object) : boolean {
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
		: 	Promise.resolve({state: new RootState(this._router), all: {$$params: params}})
		).then(act => {

			// If the state is already active, then there
			// is no need to try to reactivate it, unless of course
			// params have changed.
			if (previous[this.name] && this._sameParams(previous.$$params, params)) {
				act.state = act.all[this.name] = previous[this.name];
				return act;
			}

			// Build the parameter list
			const prms = [];
			for (var pname of this.param_names)
				prms.push(params[pname]);

			const self = this
			/**
			 * Creating the state function.
			 */
			const StateInstance = function () {
				this._name = self.name
				this._definition = self
				this.$params = params
				this._listeners = {}
				this._controllers = []
			}

			StateInstance.prototype = act.state
			const state = new StateInstance

			return Promise.resolve(this._fn.apply(state, prms)).then(nothing => {
				act.all[this.name] = state;
				act.state = state;
				return act;
			})
		});

	}


}

