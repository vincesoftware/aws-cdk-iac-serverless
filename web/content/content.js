const { reactive, computed } = Vue;

const template = `
  <section>

    <label>
      {{ state.message }}
    </label>

    <div>
      <button @click="loadIssues()">Load issues</button>
    </div>
    <div>
        <h2>Issues</h2>
        <table>
            <thead>
                <tr><th>From</th><th>Updated</th><th>Subject</th></tr>
            </thead>
            <tbody>
                <tr v-for="(row, idx) in state.issues" :key="'iss'+idx" @click="openIssue(row.pk)">
                    <th>{{ row.createdBy }}</th>
                    <th>{{ row.lastUpdated }}</th>
                    <th>{{ row.subject }}</th>
                </tr>
            </tbody>
        </table>
    </div>
    <div v-if="state.hasSelectedIssue">
        <h2>{{ state.selectedIssueHeader?.subject }}</h2>
        <h3>A crybaby story from <em>{{ state.selectedIssueHeader?.createdBy }}</em></h3>
        
        <hr>
            <div>
                <h3>Add comment</h3>
                <textarea v-model="state.newComment" style="width: 500px; height: 200px;"></textarea>
                <br>
                <input type="checkbox" v-model="state.newCommentInternal">Internal</input>
                <br>
                <button @click="submitComment(state.selectedIssueHeader?.pk)">Send it</button>
            </div>

        <hr>
        
        <div v-for="(comment, idx) in state.selectedIssueComments" :key="'com' + idx" :class="{ 'internal': comment.type === 'internal', 'response': comment.from.endsWith('@beef.support') }">
            <h4>{{ comment.from }}</h4>
            <span v-if="comment.type === 'internal'"><em>INTERNAL COMMENT</em></span>
            <blockquote>{{ comment.message }}</blockquote>
            
            <p>Updated at {{ comment.lastUpdated }}</p>
        </div>
    </div>

  </section>
`;

export default {
    template,

    data () {
        return {

        };
    },

    setup () {
        const baseUri = 'https://9vjrznpd01.execute-api.eu-west-1.amazonaws.com';
        const options = {
            headers: {
                authorization: 'Bearer uhimmuhimuhmuihmi0gmih0hmui'
            }
        };

        const state = reactive({
            issues: [],
            selectedIssue: [],
            newComment: '',
            newCommentInternal: false,

            selectedIssueHeader: computed(() => {
                const { selectedIssue } = state;
                return selectedIssue.find(x => x.sk === 'HEADER');
            }),
            selectedIssueComments: computed(() => {
                const { selectedIssue } = state;
                return selectedIssue.filter(x => (x.sk ?? '').startsWith('COMMENT#'));
            }),
            hasSelectedIssue: computed(() => {
                return state.selectedIssue.length > 0;
            })
        });

        function loadIssues() {
            state.selectedIssue = [];
            axios.get(baseUri + '/v1/issues', options).then(res => {
                state.issues = res.data;
            });
        }

        function openIssue(id) {
            axios.get(baseUri + '/v1/issues/' + id, options).then(res => {
                state.selectedIssue.splice(0, state.selectedIssue.length, ...res.data);
                console.log('state.selectedIssue.length', state.selectedIssue.length);
            });
        }

        function submitComment(id) {
            const data = {
                message: state.newComment,
                type: state.newCommentInternal ? 'internal' : 'external',
                from: 'api-user@beef.support'
            };
            axios.post(baseUri + '/v1/issues/' + id + '/comments', {
                message: state.newComment,
                type: state.newCommentInternal ? 'internal' : 'external',
                from: 'api-user@beef.support'
            }, options).then(res => {
                // add locally added comment
                state.selectedIssue.splice(0, 0, {
                    ...data,
                    lastUpdated: new Date().toISOString()
                });
            });
        }

        return {
            state,
            loadIssues,
            openIssue,
            submitComment
        };
    }
};
