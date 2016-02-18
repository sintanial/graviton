Graviton
=========

Graviton is a headless browser based on [Electron](http://electron.atom.io/).
  
It's very similar to [Nightmare](https://github.com/segmentio/nightmare), but evaluated directly by electron, without process fork and ipc communication.
  
Because graviton work directly over electron, this allows you to use all features of electron.  
For example: listen all available callbacks, use events in callback, manipulate with WindowBrowser, WebContents, and other electron api.  
Adding new features has become much easier.
  
I tried replicate Nightmare API, for simple and fast usage by users which have experience with Nightmare.   
If anybody want to help identical copy Nightmare API, pull request welcome. 
 

## How to use
```
npm install electron-prebuild
npm install graviton
./node_modules/.bin/electron test.js
```


## Example search in yahoo (like Nightmare yahoo example)
```javascript
    var Graviton = require('./lib/graviton');
    var vo = require("vo");
    
    vo(run)(function (err, result) {
        if (err) throw err;
    });
    
    function *run() {
        var graviton = yield Graviton.new({electron: {
            show: true,
        }});
    
        yield graviton.goto('http://yahoo.com', "dom");
        yield graviton.type('#uh-search-box', 'github nightmare');
        yield graviton.click('#uh-search-button');
        yield graviton.wait('#main');
        console.log(yield graviton.evaluate(function () {
            return document.querySelector('#main .searchCenterMiddle li a').href
        }));
    
        yield graviton.end();
    }
```

## Example 
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
