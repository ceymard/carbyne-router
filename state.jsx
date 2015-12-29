
import {o, merge} from 'carbyne';

/**
 * A single state, able to tell if it matches an url.
 */
export class StateDefinition {

	constructor(name, url, fn, parent, router) {
		this.name = name;
		this.url_part = url;
		this.full_url = '';
		this.fn = fn;
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

		this.full_url = full_url;
	}

	getUrl(params = {}) {
		if (this.virtual) throw new Error('Virtual states don\'t have urls.');
		let url = this.full_url;
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

		let newstate = null;
		let act = null;

		// If we have a parent, we start by trying to activate
		return (this.parent ?
			this.parent.activate(params, previous)
		: 	Promise.resolve({parent: {views: {}, data: {}}, all: {$$params: params}})
		).then(activation => {

			act = activation;

			// If the state is already active, then there
			// is no need to try to reactivate it, unless of course
			// params have changed.
			if (previous[this.name] && this._sameParams(previous.$$params, params)) {
				newstate = act.all[this.name] = previous[this.name];
				return null;
			}

			newstate = {
				name: this.name,
				views: merge({}, act.parent.views),
				data: merge({}, act.parent.data)
			};

			act.all[this.name] = newstate;

			const prms = [];
			for (var pname of this.param_names)
				prms.push(params[pname]);

			// tell the function to give us a result
			return this.fn.apply({
				views: newstate.views,
				data: newstate.data,
				params: params,
				router: this.router
			}, prms);
		}).then(res => {
			return {parent: newstate, all: act.all};
		});

	}


}

