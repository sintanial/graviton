## Usage example

```javascript
   var Graviton = require("graviton");
   var vo = require('vo');
   
   vo(run)(function (err, result) {
       if (err) throw err;
   });
   
   const GITHUB_LOGIN = '{SOME_LOGIN}';
   const GITHUB_PASS = '{SOME_PASS}';
   
   function *run() {
       var graviton = yield Graviton.new({
           electron: {
               show: true,
           }
       });
   
       try {
           yield graviton.goto("https://github.com/");
           yield graviton.evaluate(()=> {
               document.querySelector(`.header-actions .btn[href="/login"`).click();
           });
           yield graviton.wait();
           yield graviton.evaluate((GITHUB_LOGIN, GITHUB_PASS)=> {
               document.querySelector("#login_field").value = GITHUB_LOGIN;
               document.querySelector("#password").value = GITHUB_PASS;
               document.querySelector(".btn.btn-primary.btn-block").click();
           }, GITHUB_LOGIN, GITHUB_PASS);
   
           yield graviton.wait();
           console.log(yield graviton.evaluate(()=> {
               return document.title;
           }));
       } catch (e) {
           console.log(e);
       }
   
       yield graviton.end();
   }
```