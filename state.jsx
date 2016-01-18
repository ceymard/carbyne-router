
import {o, merge, Eventable} from 'carbyne';

type Views = {[key : string] : () => Atom};

export class State extends Eventable {

	data : {[key : string]: any};
	params : {[key : string]: string};
	views : Views;
	child : ?State;
	parent : ?State;

	_router : Router;

	constructor(name, router, parent, params) {
		super();
		this.name = name;
		this.data = merge({}, parent ? parent.data : {});
		this.views = merge({}, parent ? parent.views : {});
		this.params = params;
		this.parent = parent;
		this._controllers = [];
		this._router = router;
	}

	addController(ctrl) {
		this._controllers.push(ctrl);
		ctrl.setAtom(this); // XXX
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

      state = state.parent;
    }

    return null;

  }

	observe(obs, cbk) {
		this.on('destroy', o.observe(obs, cbk));
	}

	emit(event, ...args) {
		const ev = this._mkEvent(event);
		this.trigger(event, ...args);
		if (this.parent) this.parent.emit(event, ...args);
	}

	broadcast(event, ...args) {
		const ev = this._mkEvent(event);
		this.trigger(event, ...args);
		if (this.child) this.child.broadcast(event, ...args);
	}

	/**
	 * Go to the given state of the current router.
	 * Also, pre-fills the asked params.
	 */
	go(state_name, params) {
		this._router.go(state_name, params);
	}

	_build(...args) : Promise {
		return (Promise.resolve(this.build(...args))).then(views => {
			merge(this.views, views||{})
		});
	}

	build() : Promise<Views> {
		/// ?????
	}

	destroy() {
		this.trigger('destroy');
		this.views = null;
		this.data = null;
		this.params = null;
		this._router = null;
		this._controllers = null;
	}

}

/**
 * A single state, able to tell if it matches an url.
 */
export class StateDefinition {

	constructor(name, url, kls, parent, router) {
		this.name = name;
		this.url_part = url;
		this._full_url = '';
		this._kls = kls;
		this.parent = parent;
		this.param_names = [];
		this.regexp = null;
		this.router = router;

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

		this.regexp = new RegExp('^' + full_url.replace(/:[a-zA-Z_$]\w*/g, (v) => {
			this.param_names.push(v.slice(1)); // remove the leading :
			return '([^/]+)';
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
		: 	Promise.resolve({state: null, all: {$$params: params}})
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

			// Instanciate the state
			const state = new this._kls(
				this.name,
				this.router,
				act.state,
				params
			);

			// And then build it and forward it to the next state creator

			return state._build(...prms).then(nothing => {
				act.all[this.name] = state;
				act.state = state;
				return act;
			});
		});

	}


}

