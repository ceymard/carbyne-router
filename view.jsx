import {VirtualAtom, Controller} from 'carbyne';


export class ViewAtom extends VirtualAtom {
  constructor(name, tag) {
    super(tag || null)
    this.name = `View<${name}>`
  }
}


export class ViewController extends Controller {
  constructor(name) {
    super()
    this.name = name
  }

  onMount() {
    if (!this.router) {
      let parent_ctrl = this.atom.parent.getController(ViewController)
      this.setRouter(parent_ctrl.router)
    } else this.link()
  }

  link() {
    if (this.atom && this.router) {
      this.atom.observe(this.router.o_state.path(this.name), (v) => {
        if (v && typeof v !== 'function') throw new Error(`Views must be functions in '${this.name}'`)
        this.setContent(v)
      })
    }
  }

  setContent(c) {
    this.atom.empty().then(e => {
      this.atom.append(c)
    }) // detach the children, remove the children.
  }

  setRouter(router) {
    this.router = router
    this.link()
  }
}


/**
 * A view is a virtual node.
 */
export function View(attrs, children) {

  let vctrl = new ViewController(attrs.name)

  let atom = new ViewAtom(attrs.name, attrs.tag)
  atom.addController(vctrl)

  if (attrs.router)
    vctrl.setRouter(attrs.router)

  return atom

}
