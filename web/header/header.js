const template = `
  <header :style="{ 'background-color': bgColor }">
    {{ text }}
  </header>
`;

export default {
    template,

    props: {
        bgColor: {
            type: String,
            default: '#dde1f3'
        }
    },

    setup () {
        const text = '☹️ HELLO, I AM SUPPORT, BUT NOT FOR YOU 😭';

        return {
            text
        };
    }
};
