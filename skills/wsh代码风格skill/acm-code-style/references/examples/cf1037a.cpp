//               BggBB                wZPXsv:.         UBgQGv
//               BgEQQ            ,:sJ.    .,.  ::,    rBORZJ
//              .BgggB   .sJrc7r77:.,          .:;75as :BgOMp
//              :BgERB. 2a:          ,:.             :cEBOgMB:
//       wR:    rBODgBKL:  ,:r:     ,srLL;.        .   ,BRggBJ ;       s
//       gR1    sBgDBQi  :csLr;         ,rJ7.       ,,  BMp5QQJ;w:   :rg,
//   JRJipEs    XBRBO   7s;,               :c;        .,BE5OgB  :7L    L
//    cZQDB:    RBBP  :L;.                   :r         GBBEgQ5 .;:w
//       ..    ;DBZ  r7.         ............ :r         rBBpgBr  i.w.
//            pBBR  r;      ........,.....,....:r .        BBGEOZ  r w,
//           BQBB  :,      ..,:.................i:.,.       gBQB6B1;r 5:
//           5BB       ..:,...;.......,.,........:.     .QL  ZBRMXBB,. X.
//            B.     ... 7r ..:,...,.,....:: ....:,.XQr;BBB   EBGMB.    L
//         ,DB:     ..,. :L   ,r  ,.,.,.. :B: ....: 1BHKBQB;   RBgMES:
//     2   GB:   .  ,,.. rg  . w;.........:X2;.::::.    ,SE,    BBRBQBa
//     ;   77,  . .,,... 7S,...,5...,.,.. ;7 1: ..::...     ,.  .BMEGB:
//        sr;R . ..,.... U:S ...rr.....,. s; .Jr  .,.........,.  2QSgr ..
//       K2 X:   ,,.,.:::2 1; ..,::.......X    ri  ....,,.....,.  BJM  ..
//     ,Q7  Q   .,....c;.L .5  ..,...,.. cr .:ri2a   . ;r..,.,.,  P:P:,
//    ;H.  ra  .,.,.. H7:;  ,c   .,,,,,.:U RBBBBBBB:,. .r ....,,  r:p,;r
//         G: .i.... :s::r;2pBL:; .,,,..K. Bss5L7LEMJvrr;...:..,  ,pZ :X:
//         M  .::... 7:.7QBBBBBKBr.....sr    w:,  ,:6.r;,..::.,.  :5:  :Z
//         Q ...i,.. 1sBO::U;; :rvr:::cr     6 :HS, p  X. :;....  :U L  :
//         O ...,r.  BBP  77..,r;c .LS:      w; r;  H  1 ,;....., rJ;H
//         g ....,i, OS   ,X..7HrL   :        1r..:s. L:,;....,:. K2:.L
// .:i;:, .g  .....:;sES   L7 .,,7             ,. ,  r;,:.,..::. iE;: s.
// ;.  .ss:M; :..,...v:17   ;7,.:.  .              .7;.,.. ;7: .rD,:i; 2
//   ,.   : G:6r. ... ;7g.                       rJi:.  ,:J1:.r2,rr::v ;,
//   7v7: ;.7:7UP2i:,:rr,7          .. .::         rJrrcJsc: L;L: J;::7 r
// i....:visP.27rLJLU5r;css         ,.            ,5s,c;:,r. c..c  7;,v,
// : ,. i, ,RO.:       .E;Hw,                   .DBH7;r7.:i  X5LLU. .. r
// , ...BU.  .w:;r1r    .sr,vc:               .pBREDQBBL.;:  QBBBBBXXP7.
// , , :QBB1 ;:7v:vJ:    Jv.i1EgBgJi,     .,::.gDZKPHGBs,;  .BQMDU5GQBBB7
// , .. LDr 7rLLL,U,r.   cDQBQBRGERQBBQ,:;r7s2PDRZZpEDBL,., ,BRpZZZZOOgB7
// , .:. . DQK.r.7; r.   :gBDZpZPEpZ6gMa6RMBBQgEKZ6DDMBr,..::BEZpEGDZPPG
//   si,: :2QBac;..,r     PQgPPPEZOZDGDRRDDEGpZpOOgORBH,: ..:Qg6ZZp2JsO;
//  Q: :J7 7      .,.     6RQQDD6ZpZpZ6Z6ZpZ6gOgDOGRDR  :.  .MMOpX52UKDr
// BB7 1  .:UMOPXr        gQgEgDDZZpE6E6Z6ZPZGOpDRDUSOEHBBL  7BRP5HXXXDJ.
// GXB1  .: UBMQBBg       JB6pKpPG6O6G6EZEpEPp6MGSwPEDRQgMBP  :RPXUX6PQa;
// gXOR .,,pgGE6ODBB,      QQOZ6RMBBBQMgDZZ6ZGE21HOEZpEpEZgB,  :ZZppBQs,v
// gwXBr,;EBEEpGZGGBQ:     .RMgK7r:::i7s1HPZHDHLEGPpKpK6PpZBs .D;g6GMZ  ;

#include<bits/stdc++.h>

using namespace std;

#define int long long
#define ll long long
#define ull unsigned long long
#define lowbit(x) (x&(-x))

const int MOD=1e9 + 7;
const int N=1e6+10;

int qpow(int num,int k) {
    int res=1;
    while(k) {
        if(k%2) res = (res * num) % MOD;
        num = (num * num) % MOD;
        k/=2 ;
    }
    return res % MOD;
}

int inv(int x) {
    return qpow(x,MOD-2);
}
 
int lcm(int x,int y) {
    return x * y / __gcd(x,y);
}

mt19937 rng(chrono::steady_clock::now().time_since_epoch().count());
int Base = uniform_int_distribution<>(8e8,9e8)(rng); 

int a[N];
int b[N];

void solve() {
    int n;
    cin>>n;

    int res = 9;
    while(n) {
        res = min(n % 10,res);
        n /= 10;
    }

    cout<<res<<"\n";
}

signed main() {
    ios::sync_with_stdio(false);
    cin.tie(0);
    cout.tie(0);

    int t=1;
    cin>>t;

    while(t--) {
        solve();
    }
    return 0;
}
