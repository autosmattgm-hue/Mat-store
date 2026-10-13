const fs = require('fs');
const path = ['check_balance.js','check_balance.cjs','check_balance2.cjs','check_balance3.cjs','check_balance4.cjs','check_balance5.cjs','remove-methods.cjs','remove-methods2.cjs','remove-extra.cjs','remove226.cjs','delete-line.cjs','check_region.cjs','test_parse.js','test_parse2.js','test_extra.js','test_remove226.js','t.js','t2.js','t3.js','check_error.txt','t.cjs','check_balance2.js'];
path.forEach(p => {
  try { fs.unlinkSync('e:/jjjjjj/' + p); } catch (e) {}
});
console.log('cleanup done');
