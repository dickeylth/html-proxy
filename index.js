/**
 * Created by 弘树<tiehang.lth@alibaba-inc.com> on 14-4-22.
 */

'use strict';

var http = require('http');
var url = require('url');
var fs = require('fs');

var Juicer = require('juicer');
var iconv = require('iconv-lite');
var cheerio = require('cheerio');
var request = require('request');
var beautify_html = require('js-beautify').html;

var mock = require('./lib/mock');

function HTMLProxy(config) {
    var self = this;
    this.init(config);
}

HTMLProxy.prototype = {

    /**
     * 初始化
     * @param options {Object} 配置项
     */
    init: function (options) {

        var self = this;

        // 对html-proxy的配置进行解析，缓存所有的urlReg
        var htmlProxyConfig = options.htmlProxyConfig,
            htmlProxyRegUrls = [];
        //console.log(htmlProxyConfig);
        if (htmlProxyConfig) {
            htmlProxyConfig.forEach(function (cfgItem) {
                htmlProxyRegUrls.push(new RegExp(cfgItem.urlReg));
            });
        }

        self.htmlProxyRegUrls = htmlProxyRegUrls;
        self.htmlProxyConfig = htmlProxyConfig;
        self.port = options.htmlProxyPort || 8090;

        if (options.needServer) {
            self.server = this.createServer();
        }
    },

    /**
     * 创建本地 html-proxy 代理服务
     * @returns {*}
     */
    createServer: function () {

        var self = this,
            htmlProxyConfig = self.htmlProxyConfig;

        /**
         * 创建HTML-Proxy服务器
         */
        return http.createServer(function (req, res) {

            console.log('HTMLProxy处理：' + req.url);

            var reqQuery = url.parse(req.url, true).query,
                reqUrl = reqQuery.reqUrl;

            if (reqUrl) {

                var matchIdx = reqQuery.matchIdx,
                    options = url.parse(reqUrl, true);

                // 带上原请求的所有请求头，重要的是 cookie，以同步服务器端会话
                //options.headers = req.headers;

                request({
                    url: reqUrl,
                    headers: req.headers,
                    encoding: null
                }, function(error, response, body){

                    if (!error && response.statusCode == 200) {

                        var responseCharset = 'utf-8',
                            responseHeaders = response.headers;

                        // 检测是否响应体为 utf-8 编码，便于后面转码处理
                        if (responseHeaders['content-type']) {
                            var contentType = responseHeaders['content-type'],
                                charsetMatch = contentType.match(/charset=([\w-]+)/ig);

                            if (charsetMatch && (charsetMatch.length != 0)) {
                                responseCharset = charsetMatch[0].split('=')[1];
                            }

                        }

                        // 获取替换关系
                        var replacements = htmlProxyConfig[matchIdx].replacements;
                        // 根据响应头指定的编码进行解码
                        var pageContent = iconv.decode(body, responseCharset);
                        // 替换相应区块的 html 片段
                        var replacedHTML = self.replaceDom(pageContent, replacements);
                        // html 美化，转回响应头指定的编码
                        var encodedHTML = iconv.encode(beautify_html(replacedHTML), responseCharset);
                        // 响应到浏览器
                        res.end(encodedHTML);

                    } else {

                        console.log('failed to load remote page: ' + url);

                    }

                });

            }

        }).listen(self.port);
    },

    /**
     * 替换 HTML 字符串中指定 dom 的内容
     * @param str {String} HTML 字符串
     * @param replacements {Array} 替换配置
     * @returns {*}
     */
    replaceDom: function (str, replacements) {

        var pwd = process.cwd();

        var $ = cheerio.load(str);

        replacements.forEach(function (item, idx) {

            var filePath = path.resolve(pwd + '/src/' + item.fragment),
                fileContent = fs.readFileSync(filePath),
                fileContentStr = fileContent.toString();

            if (mock.checkDef(fileContentStr)) {
                var pageParam = mock.getMockData(fileContentStr);
                fileContentStr = Juicer(fileContentStr, pageParam);
                fileContentStr = beautify_html(fileContentStr);
            }

            $(item.selector).html(fileContentStr);

        });

        return $.html();

    },

    /**
     * 对匹配上的请求 url, 配置 RProxy 反向代理的 config， 使其转发请求到 html-proxy 服务
     * @param request {Object} 请求对象
     * @param config {Object} RProxy 的请求配置
     *
     */
    exportConfigForRProxy: function (request, config) {

        var self = this,
            reqUrl = request.url,
            htmlProxyRegUrls = self.htmlProxyRegUrls,
            htmlProxyPort = self.port;

        // 检查是否匹配HTML-Proxy中的某个URL RegExp
        htmlProxyRegUrls.forEach(function (urlReg, idx) {

            if (urlReg.test(reqUrl)) {

                config.host = 'localhost';
                config.path += (config.path.indexOf('?') > 0) ? '&' : '?' + 'reqUrl=' + reqUrl;
                config.path += '&matchIdx=' + idx;
                config.port = htmlProxyPort;

                // 拷贝请求头
                var reqHeaders = request.headers,
                    reqHeaderKeys = Object.keys(reqHeaders);
                reqHeaderKeys.forEach(function(key){
                    config.headers[key] = reqHeaders[key];
                });
                delete config.headers['accept-encoding'];
                config.headers['accept'] = 'text/html,application/xhtml+xml,application/xml,*/*;';

            }
        });

        return config;

    }

};

module.exports = HTMLProxy;