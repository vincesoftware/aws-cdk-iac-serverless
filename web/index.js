import Header from './header/header.js'
import Content from './content/content.js'
import Footer from './footer/footer.js'

const { createApp } = Vue

const App = createApp({
  components: {
    'app-header': Header,
    'app-content': Content,
    'app-footer': Footer
  },

  mounted () {
    console.log('Application mounted.')
  }
})


window.addEventListener('load', () => {
  App.mount('main')
})
